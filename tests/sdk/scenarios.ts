import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { randomBytes } from "crypto";
import path from "path";
import * as snarkjs from "snarkjs";
import { bigintToBytesBE, bytesToBigIntBE, poseidonHash, poseidonHashBytes } from "../../src/sdk/poseidon";
import {
  createArciumClient,
  encodeEncryptedBalance,
  generateArciumKeypair,
  ArciumKeypair,
} from "../../src/sdk/arcium";
import BN from "bn.js";

export interface Note {
  nullifier: bigint;
  secret: bigint;
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
}

export interface WalletState {
  keypair: Keypair;
  arciumKeypair: ArciumKeypair;
  arciumClient: any;
  currentNote: Note;
  commitment: Buffer;
  noteHash: Uint8Array;
  tokenAccounts: Record<string, PublicKey>;
}

export class ScenarioRunner {
  program: Program<any>;
  provider: anchor.AnchorProvider;
  wallets: WalletState[] = [];
  merkleTreeLeaves: Buffer[] = [];
  merkleDepth: number = 4;
  
  // PDAs
  vault: PublicKey;
  merkleTree: PublicKey;
  receiptMint: PublicKey;
  borrowMint: PublicKey;
  vaultCollateralAccount: PublicKey;
  collateralMint: PublicKey;

  constructor(program: Program<any>, provider: anchor.AnchorProvider, collateralMint: PublicKey) {
    this.program = program;
    this.provider = provider;
    this.collateralMint = collateralMint;
    
    // Derive PDAs (matching veillend.ts logic)
    [this.vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), collateralMint.toBuffer()],
      program.programId
    );
    [this.merkleTree] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree"), this.vault.toBuffer()],
      program.programId
    );
    [this.receiptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), this.vault.toBuffer()],
      program.programId
    );
    [this.borrowMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("borrow"), this.vault.toBuffer()],
      program.programId
    );
    [this.vaultCollateralAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_collateral"), this.vault.toBuffer()],
      program.programId
    );
  }

  async addWallet(): Promise<number> {
    const keypair = Keypair.generate();
    const arciumKeypair = generateArciumKeypair();
    const arciumClient = createArciumClient(arciumKeypair);
    
    // Airdrop
    const sig = await this.provider.connection.requestAirdrop(keypair.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await this.provider.connection.confirmTransaction(sig);

    const walletIdx = this.wallets.length;
    this.wallets.push({
      keypair,
      arciumKeypair,
      arciumClient,
      currentNote: this.createEmptyNote(),
      commitment: Buffer.alloc(32),
      noteHash: new Uint8Array(32),
      tokenAccounts: {}
    });

    // Initialize token accounts
    const collateralATA = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      (this.provider.wallet as any).payer,
      this.collateralMint,
      keypair.publicKey
    );
    this.wallets[walletIdx].tokenAccounts['collateral'] = collateralATA.address;

    const borrowATA = await getOrCreateAssociatedTokenAccount(
      this.provider.connection,
      (this.provider.wallet as any).payer,
      this.borrowMint,
      keypair.publicKey
    );
    this.wallets[walletIdx].tokenAccounts['borrow'] = borrowATA.address;

    // Mint some collateral
    await mintTo(
      this.provider.connection,
      (this.provider.wallet as any).payer,
      this.collateralMint,
      collateralATA.address,
      this.provider.wallet.publicKey,
      100 * anchor.web3.LAMPORTS_PER_SOL
    );

    return walletIdx;
  }

  createEmptyNote(): Note {
    return {
      nullifier: 0n,
      secret: 0n,
      supplySol: 0n,
      supplyUsdc: 0n,
      borrowSol: 0n,
      borrowUsdc: 0n,
      timestamp: 0n,
    };
  }

  // Utility helpers (extracted from veillend.ts)
  clampFieldElement(bytes: Uint8Array) {
    const normalized = Uint8Array.from(bytes);
    normalized[0] &= 0x1f;
    return Buffer.from(normalized);
  }

  async computeCommitment(note: Note) {
    return poseidonHash([
      note.nullifier,
      note.secret,
      note.supplySol,
      note.supplyUsdc,
      note.borrowSol,
      note.borrowUsdc,
      note.timestamp,
    ]);
  }

  async computeNullifierHash(nullifier: Uint8Array) {
    return poseidonHash([bytesToBigIntBE(nullifier), 0n]);
  }

  async hashPair(left: Buffer, right: Buffer) {
    return Buffer.from(await poseidonHashBytes([left, right]));
  }

  async computeZeroHashes(depth: number) {
    const defaultCommitment = Buffer.from("0a47ead74da5372e7d2598e4f93c389bf03e8330219f8bf1e49b362f73491a26", "hex");
    const hashes: Buffer[] = [defaultCommitment];
    for (let i = 0; i < depth; i += 1) {
      hashes.push(await this.hashPair(hashes[i], hashes[i]));
    }
    return hashes;
  }

  async buildMerkleTree(leaves: Buffer[], depth: number) {
    const zeroHashes = await this.computeZeroHashes(depth);
    const maxLeaves = 1 << depth;
    const padded: Buffer[] = new Array(maxLeaves);
    for (let i = 0; i < maxLeaves; i += 1) {
      padded[i] = leaves[i] ?? zeroHashes[0];
    }
    const layers: Buffer[][] = [padded];
    for (let level = 0; level < depth; level += 1) {
      const prev = layers[level];
      const next: Buffer[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        next.push(await this.hashPair(prev[i], prev[i + 1]));
      }
      layers.push(next);
    }
    return { layers, root: layers[depth][0] };
  }

  async getMerkleProof(leaves: Buffer[], index: number, depth: number) {
    const { layers, root } = await this.buildMerkleTree(leaves, depth);
    const proof: Buffer[] = [];
    const path: number[] = [];
    let currentIndex = index;
    for (let level = 0; level < depth; level += 1) {
      const siblingIndex = currentIndex ^ 1;
      proof.push(layers[level][siblingIndex]);
      path.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }
    return { proof, path, root };
  }

  toFieldString(value: Uint8Array | bigint) {
    const bigIntValue = typeof value === "bigint" ? value : bytesToBigIntBE(value);
    return bigIntValue.toString();
  }

  toFieldBytes(value: bigint | string) {
    return Array.from(bigintToBytesBE(BigInt(value), 32));
  }

  async buildGroth16Proof(action: string, input: Record<string, unknown>) {
    const wasmPath = path.resolve(__dirname, `../../circuits/veillend/build/${action}/${action}_js/${action}.wasm`);
    const zkeyPath = path.resolve(__dirname, `../../circuits/veillend/build/${action}/setup_final.zkey`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    return { proof, publicSignals };
  }

  toGroth16Proof(proof: any) {
    return {
      aX: this.toFieldBytes(proof.pi_a[0]),
      aY: this.toFieldBytes(proof.pi_a[1]),
      bX0: this.toFieldBytes(proof.pi_b[0][0]),
      bX1: this.toFieldBytes(proof.pi_b[0][1]),
      bY0: this.toFieldBytes(proof.pi_b[1][0]),
      bY1: this.toFieldBytes(proof.pi_b[1][1]),
      cX: this.toFieldBytes(proof.pi_c[0]),
      cY: this.toFieldBytes(proof.pi_c[1]),
    };
  }

  async depositSecure(walletIdx: number, amount: bigint) {
    const wallet = this.wallets[walletIdx];
    const oldNote = wallet.currentNote;
    
    const nullifier = this.clampFieldElement(randomBytes(32));
    const secret = this.clampFieldElement(randomBytes(32));
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    
    const newNote: Note = {
      nullifier: bytesToBigIntBE(nullifier),
      secret: bytesToBigIntBE(secret),
      supplySol: oldNote.supplySol + amount,
      supplyUsdc: 0n,
      borrowSol: oldNote.borrowSol,
      borrowUsdc: 0n,
      timestamp,
    };

    const newCommitmentValue = await this.computeCommitment(newNote);
    const commitment = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
    const noteHash = Array.from(commitment); 

    const encryptedBalance = encodeEncryptedBalance(
      wallet.arciumClient.encryptPosition(newNote.supplySol, newNote.borrowSol)
    );
    const clientKey = Array.from(wallet.arciumKeypair.publicKey);

    const [noteReceipt] = PublicKey.findProgramAddressSync(
      [Buffer.from('note_receipt'), this.vault.toBuffer(), Buffer.from(noteHash)],
      this.program.programId,
    );
    
    const receiptMintATA = await anchor.utils.token.associatedAddress({
      mint: this.receiptMint,
      owner: noteReceipt,
    });

    await this.program.methods
      .depositSecure(
        new BN(amount.toString()),
        encryptedBalance,
        clientKey,
        noteHash,
        Array.from(commitment),
      )
      .accountsStrict({
        user: wallet.keypair.publicKey,
        vault: this.vault,
        noteReceipt,
        receiptMint: this.receiptMint,
        noteReceiptTokenAccount: receiptMintATA,
        userCollateralAccount: wallet.tokenAccounts['collateral'],
        vaultCollateralAccount: this.vaultCollateralAccount,
        merkleTree: this.merkleTree,
        collateralMint: this.collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([wallet.keypair])
      .rpc();

    // Update state
    wallet.currentNote = newNote;
    wallet.commitment = commitment;
    wallet.noteHash = new Uint8Array(noteHash);
    this.merkleTreeLeaves.push(commitment);
  }

  async borrowSecure(walletIdx: number, amount: bigint) {
    const wallet = this.wallets[walletIdx];
    const oldNote = wallet.currentNote;
    const oldCommitmentValue = await this.computeCommitment(oldNote);
    
    const newNullifier = this.clampFieldElement(randomBytes(32));
    const newSecret = this.clampFieldElement(randomBytes(32));
    const newTimestamp = BigInt(Math.floor(Date.now() / 1000));
    
    const newNote: Note = {
      nullifier: bytesToBigIntBE(newNullifier),
      secret: bytesToBigIntBE(newSecret),
      supplySol: oldNote.supplySol,
      supplyUsdc: 0n,
      borrowSol: oldNote.borrowSol + amount,
      borrowUsdc: 0n,
      timestamp: newTimestamp,
    };

    const newCommitmentValue = await this.computeCommitment(newNote);
    const newCommitment = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
    const nullifierHash = await this.computeNullifierHash(bigintToBytesBE(oldNote.nullifier, 32));

    const leafIndex = this.merkleTreeLeaves.findIndex(l => l.equals(wallet.commitment));
    const { proof, path, root } = await this.getMerkleProof(this.merkleTreeLeaves, leafIndex, this.merkleDepth);

    const circuitInput = {
      merkleRoot: this.toFieldString(root),
      pathElements: proof.map(node => this.toFieldString(node)),
      pathIndices: path,
      oldNullifier: this.toFieldString(bigintToBytesBE(oldNote.nullifier, 32)),
      oldSecret: this.toFieldString(bigintToBytesBE(oldNote.secret, 32)),
      oldSupplySol: oldNote.supplySol.toString(),
      oldSupplyUsdc: "0",
      oldBorrowSol: oldNote.borrowSol.toString(),
      oldBorrowUsdc: "0",
      oldTimestamp: oldNote.timestamp.toString(),
      deltaBorrowSol: amount.toString(),
      deltaBorrowUsdc: "0",
      newNullifier: this.toFieldString(newNullifier),
      newSecret: this.toFieldString(newSecret),
      newTimestamp: newTimestamp.toString(),
      publicNullifierHash: nullifierHash.toString(),
      publicOldCommitment: oldCommitmentValue.toString(),
      publicNewCommitment: newCommitmentValue.toString(),
    };

    const zkProofData = await this.buildGroth16Proof("borrow", circuitInput);
    const zkProof = this.toGroth16Proof(zkProofData.proof);

    const encryptedBalance = encodeEncryptedBalance(
      wallet.arciumClient.encryptPosition(newNote.supplySol, newNote.borrowSol)
    );

    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), this.vault.toBuffer(), bigintToBytesBE(oldNote.nullifier, 32)],
      this.program.programId,
    );

    const [noteReceipt] = PublicKey.findProgramAddressSync(
      [Buffer.from('note_receipt'), this.vault.toBuffer(), wallet.noteHash],
      this.program.programId,
    );

    const newNoteHash = Array.from(newCommitment);

    await this.program.methods
      .borrowSecure(
        new BN(amount.toString()),
        encryptedBalance,
        Array.from(wallet.commitment),
        Array.from(newCommitment),
        Array.from(bigintToBytesBE(oldNote.nullifier, 32)),
        zkProof,
        proof.map(node => Array.from(node)),
        Buffer.from(path),
      )
      .accountsStrict({
        user: wallet.keypair.publicKey,
        vault: this.vault,
        noteReceipt,
        userBorrowAccount: wallet.tokenAccounts['borrow'],
        merkleTree: this.merkleTree,
        nullifierAccount: nullifierPda,
        collateralMint: this.collateralMint,
        borrowMint: this.borrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([wallet.keypair])
      .rpc();

    wallet.currentNote = newNote;
    wallet.commitment = newCommitment;
    wallet.noteHash = new Uint8Array(newNoteHash);
    this.merkleTreeLeaves.push(newCommitment);
  }

  async repaySecure(walletIdx: number, amount: bigint) {
    const wallet = this.wallets[walletIdx];
    const oldNote = wallet.currentNote;
    const oldCommitmentValue = await this.computeCommitment(oldNote);
    
    const newNullifier = this.clampFieldElement(randomBytes(32));
    const newSecret = this.clampFieldElement(randomBytes(32));
    const newTimestamp = BigInt(Math.floor(Date.now() / 1000));
    
    const newNote: Note = {
      nullifier: bytesToBigIntBE(newNullifier),
      secret: bytesToBigIntBE(newSecret),
      supplySol: oldNote.supplySol,
      supplyUsdc: 0n,
      borrowSol: oldNote.borrowSol - amount,
      borrowUsdc: 0n,
      timestamp: newTimestamp,
    };

    const newCommitmentValue = await this.computeCommitment(newNote);
    const newCommitment = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
    const nullifierHash = await this.computeNullifierHash(bigintToBytesBE(oldNote.nullifier, 32));

    const leafIndex = this.merkleTreeLeaves.findIndex(l => l.equals(wallet.commitment));
    const { proof, path, root } = await this.getMerkleProof(this.merkleTreeLeaves, leafIndex, this.merkleDepth);

    const circuitInput = {
      merkleRoot: this.toFieldString(root),
      pathElements: proof.map(node => this.toFieldString(node)),
      pathIndices: path,
      oldNullifier: this.toFieldString(bigintToBytesBE(oldNote.nullifier, 32)),
      oldSecret: this.toFieldString(bigintToBytesBE(oldNote.secret, 32)),
      oldSupplySol: oldNote.supplySol.toString(),
      oldSupplyUsdc: "0",
      oldBorrowSol: oldNote.borrowSol.toString(),
      oldBorrowUsdc: "0",
      oldTimestamp: oldNote.timestamp.toString(),
      deltaRepaySol: amount.toString(),
      deltaRepayUsdc: "0",
      newNullifier: this.toFieldString(newNullifier),
      newSecret: this.toFieldString(newSecret),
      newTimestamp: newTimestamp.toString(),
      publicNullifierHash: nullifierHash.toString(),
      publicOldCommitment: oldCommitmentValue.toString(),
      publicNewCommitment: newCommitmentValue.toString(),
    };

    const zkProofData = await this.buildGroth16Proof("repay", circuitInput);
    const zkProof = this.toGroth16Proof(zkProofData.proof);

    const encryptedBalance = encodeEncryptedBalance(
      wallet.arciumClient.encryptPosition(newNote.supplySol, newNote.borrowSol)
    );

    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), this.vault.toBuffer(), bigintToBytesBE(oldNote.nullifier, 32)],
      this.program.programId,
    );

    const [noteReceipt] = PublicKey.findProgramAddressSync(
      [Buffer.from('note_receipt'), this.vault.toBuffer(), wallet.noteHash],
      this.program.programId,
    );

    const newNoteHash = Array.from(newCommitment);

    await this.program.methods
      .repaySecure(
        new BN(amount.toString()),
        encryptedBalance,
        Array.from(wallet.commitment),
        Array.from(newCommitment),
        Array.from(bigintToBytesBE(oldNote.nullifier, 32)),
        zkProof,
        proof.map(node => Array.from(node)),
        Buffer.from(path),
      )
      .accountsStrict({
        user: wallet.keypair.publicKey,
        vault: this.vault,
        noteReceipt,
        userRepayAccount: wallet.tokenAccounts['borrow'],
        merkleTree: this.merkleTree,
        nullifierAccount: nullifierPda,
        collateralMint: this.collateralMint,
        repayMint: this.borrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
      .signers([wallet.keypair])
      .rpc();

    wallet.currentNote = newNote;
    wallet.commitment = newCommitment;
    wallet.noteHash = new Uint8Array(newNoteHash);
    this.merkleTreeLeaves.push(newCommitment);
  }

  async withdrawSecure(walletIdx: number, amount: bigint) {
    const wallet = this.wallets[walletIdx];
    const oldNote = wallet.currentNote;
    const oldCommitmentValue = await this.computeCommitment(oldNote);
    
    const newNullifier = this.clampFieldElement(randomBytes(32));
    const newSecret = this.clampFieldElement(randomBytes(32));
    const newTimestamp = BigInt(Math.floor(Date.now() / 1000));
    
    const newNote: Note = {
      nullifier: bytesToBigIntBE(newNullifier),
      secret: bytesToBigIntBE(newSecret),
      supplySol: oldNote.supplySol - amount,
      supplyUsdc: 0n,
      borrowSol: oldNote.borrowSol,
      borrowUsdc: 0n,
      timestamp: newTimestamp,
    };

    const newCommitmentValue = await this.computeCommitment(newNote);
    const newCommitment = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
    const nullifierHash = await this.computeNullifierHash(bigintToBytesBE(oldNote.nullifier, 32));

    const leafIndex = this.merkleTreeLeaves.findIndex(l => l.equals(wallet.commitment));
    const { proof, path, root } = await this.getMerkleProof(this.merkleTreeLeaves, leafIndex, this.merkleDepth);

    const circuitInput = {
      merkleRoot: this.toFieldString(root),
      pathElements: proof.map(node => this.toFieldString(node)),
      pathIndices: path,
      oldNullifier: this.toFieldString(bigintToBytesBE(oldNote.nullifier, 32)),
      oldSecret: this.toFieldString(bigintToBytesBE(oldNote.secret, 32)),
      oldSupplySol: oldNote.supplySol.toString(),
      oldSupplyUsdc: "0",
      oldBorrowSol: oldNote.borrowSol.toString(),
      oldBorrowUsdc: "0",
      oldTimestamp: oldNote.timestamp.toString(),
      deltaWithdrawSol: amount.toString(),
      deltaWithdrawUsdc: "0",
      newNullifier: this.toFieldString(newNullifier),
      newSecret: this.toFieldString(newSecret),
      newTimestamp: newTimestamp.toString(),
      publicNullifierHash: nullifierHash.toString(),
      publicOldCommitment: oldCommitmentValue.toString(),
      publicNewCommitment: newCommitmentValue.toString(),
    };

    const zkProofData = await this.buildGroth16Proof("withdraw", circuitInput);
    const zkProof = this.toGroth16Proof(zkProofData.proof);

    const encryptedBalance = encodeEncryptedBalance(
      wallet.arciumClient.encryptPosition(newNote.supplySol, newNote.borrowSol)
    );

    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), this.vault.toBuffer(), bigintToBytesBE(oldNote.nullifier, 32)],
      this.program.programId,
    );

    const [noteReceipt] = PublicKey.findProgramAddressSync(
      [Buffer.from('note_receipt'), this.vault.toBuffer(), wallet.noteHash],
      this.program.programId,
    );

    const newNoteHash = Array.from(newCommitment);
    const receipt = await this.program.account.noteReceipt.fetch(noteReceipt);

    await this.program.methods
      .withdrawSecure(
        new BN(amount.toString()),
        encryptedBalance,
        Array.from(wallet.commitment),
        Array.from(newCommitment),
        Array.from(bigintToBytesBE(oldNote.nullifier, 32)),
        zkProof,
        proof.map(node => Array.from(node)),
        Buffer.from(path),
      )
      .accountsStrict({
        user: wallet.keypair.publicKey,
        vault: this.vault,
        noteReceipt,
        receiptMint: this.receiptMint,
        noteReceiptTokenAccount: await anchor.utils.token.associatedAddress({ mint: this.receiptMint, owner: noteReceipt }),
        userCollateralAccount: wallet.tokenAccounts['collateral'],
        vaultCollateralAccount: this.vaultCollateralAccount,
        merkleTree: this.merkleTree,
        nullifierAccount: nullifierPda,
        collateralMint: this.collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
      .signers([wallet.keypair])
      .rpc();

    wallet.currentNote = newNote;
    wallet.commitment = newCommitment;
    wallet.noteHash = new Uint8Array(newNoteHash);
    this.merkleTreeLeaves.push(newCommitment);
  }
}
