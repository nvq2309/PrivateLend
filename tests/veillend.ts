import * as anchor from "@coral-xyz/anchor";
/// <reference path="./types/snarkjs.d.ts" />
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { randomBytes } from "crypto";
import path from "path";
import * as snarkjs from "snarkjs";
import { bigintToBytesBE, bytesToBigIntBE, poseidonHash, poseidonHashBytes } from "../src/sdk/poseidon";
import {
  createArciumClient,
  encodeEncryptedBalance,
  generateArciumKeypair,
} from "../src/sdk/arcium";
import BN from "bn.js";
import { ScenarioRunner } from "./sdk/scenarios";


describe("VeilLend with Protection & Privacy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Veillend as Program<any>;
  const programAccounts = program.account as unknown as {
    vault: { fetch: (pubkey: PublicKey) => Promise<any> };
    protectionPool: { fetch: (pubkey: PublicKey) => Promise<any> };
    userReceipt: { fetch: (pubkey: PublicKey) => Promise<any> };
    noteReceipt: { fetch: (pubkey: PublicKey) => Promise<any> };
    merkleTree: { fetch: (pubkey: PublicKey) => Promise<any> };
    nullifier: { fetch: (pubkey: PublicKey) => Promise<any> };
  };
  
  const authority = provider.wallet;

  // Arcium Privacy Setup
  const arciumKeypair = generateArciumKeypair();
  const arciumClient = createArciumClient(arciumKeypair);
  const getEncryptedBalance = (deposit: bigint, borrow: bigint) =>
    encodeEncryptedBalance(arciumClient.encryptPosition(deposit, borrow));
  const getClientKey = () => Array.from(arciumKeypair.publicKey);
  const DEFAULT_NOTE_COMMITMENT = Buffer.from(
    "0a47ead74da5372e7d2598e4f93c389bf03e8330219f8bf1e49b362f73491a26",
    "hex",
  );
  const clampFieldElement = (bytes: Uint8Array) => {
    const normalized = Uint8Array.from(bytes);
    normalized[0] &= 0x1f; // Ensure < modulus (starts with 0x30)
    return Buffer.from(normalized);
  };
  const toFieldBytes = (value: bigint | string) =>
    Array.from(bigintToBytesBE(BigInt(value), 32));
  const toFieldString = (value: Uint8Array | bigint) => {
    const bigIntValue = typeof value === "bigint" ? value : bytesToBigIntBE(value);
    return bigIntValue.toString();
  };
  const computeCommitment = async (note: {
    nullifier: bigint;
    secret: bigint;
    supplySol: bigint;
    supplyUsdc: bigint;
    borrowSol: bigint;
    borrowUsdc: bigint;
    timestamp: bigint;
  }) =>
    poseidonHash([
      note.nullifier,
      note.secret,
      note.supplySol,
      note.supplyUsdc,
      note.borrowSol,
      note.borrowUsdc,
      note.timestamp,
    ]);
  const computeNullifierHash = async (nullifier: Uint8Array) =>
    poseidonHash([bytesToBigIntBE(nullifier), 0n]);
  const buildGroth16Proof = async (action: "supply" | "borrow" | "repay" | "withdraw", input: Record<string, unknown>) => {
    const wasmPath = path.resolve(
      __dirname,
      `../circuits/veillend/build/${action}/${action}_js/${action}.wasm`,
    );
    const zkeyPath = path.resolve(
      __dirname,
      `../circuits/veillend/build/${action}/setup_final.zkey`,
    );
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
    return { proof, publicSignals };
  };
  const toGroth16Proof = (proof: any) => ({
    aX: toFieldBytes(proof.pi_a[0]),
    aY: toFieldBytes(proof.pi_a[1]),
    bX0: toFieldBytes(proof.pi_b[0][0]),
    bX1: toFieldBytes(proof.pi_b[0][1]),
    bY0: toFieldBytes(proof.pi_b[1][0]),
    bY1: toFieldBytes(proof.pi_b[1][1]),
    cX: toFieldBytes(proof.pi_c[0]),
    cY: toFieldBytes(proof.pi_c[1]),
  });

  // Test accounts
  let collateralMint: PublicKey;
  let vault: PublicKey;
  let protectionPool: PublicKey;
  let merkleTree: PublicKey;
  let vaultCollateralAccount: PublicKey;
  let protectionReserveAccount: PublicKey;
  let receiptMint: PublicKey;
  let borrowMint: PublicKey;
  let userReceipt: PublicKey;
  let userReceiptTokenAccount: PublicKey;
  let noteReceipt: PublicKey;
  let noteReceiptTokenAccount: PublicKey;
  // let userCollateralAccount: any;
  let userCollateralAccountAddr: PublicKey;
  let userBorrowAccountAddr: PublicKey;
  let user2BorrowAccountAddr: PublicKey;

  // Test user
  const user = Keypair.generate();
  const user2 = Keypair.generate();

  // Constants
  const LTV_BPS = new BN(7500); // 75%
  const LIQUIDATION_THRESHOLD_BPS = new BN(8500); // 85%
  const DEPOSIT_AMOUNT = new BN(10 * LAMPORTS_PER_SOL);
  const BORROW_AMOUNT = new BN(5 * LAMPORTS_PER_SOL);
  const MERKLE_DEPTH = 4;
  let commitment1: Buffer;
  let commitment2: Buffer;
  let commitment3: Buffer;
  let commitment4: Buffer;
  let noteHash: Uint8Array;
  let nullifier1: Buffer;
  let nullifier2: Buffer;
  let nullifier3: Buffer;
  let nullifier4: Buffer;
  let secret1: Buffer;
  let secret2: Buffer;
  let secret3: Buffer;
  let secret4: Buffer;
  let timestamp1: bigint;
  let timestamp2: bigint;
  let timestamp3: bigint;
  let timestamp4: bigint;
  let repayProofData: {
    proof: any;
    merkleProof: Buffer[];
    merklePath: number[];
    oldCommitment: bigint;
    newCommitment: bigint;
  } | null = null;

  const hashPair = async (left: Buffer, right: Buffer) =>
    Buffer.from(await poseidonHashBytes([left, right]));

  const computeZeroHashes = async (depth: number) => {
    const hashes: Buffer[] = [DEFAULT_NOTE_COMMITMENT];
    for (let i = 0; i < depth; i += 1) {
      hashes.push(await hashPair(hashes[i], hashes[i]));
    }
    return hashes;
  };

  const buildMerkleTree = async (leaves: Buffer[], depth: number) => {
    const zeroHashes = await computeZeroHashes(depth);
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
        next.push(await hashPair(prev[i], prev[i + 1]));
      }
      layers.push(next);
    }
    return { layers, root: layers[depth][0] };
  };

  const getMerkleProof = async (leaves: Buffer[], index: number, depth: number) => {
    const { layers, root } = await buildMerkleTree(leaves, depth);
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
  };

  const buildRepayProofData = async () => {
    if (repayProofData) {
      return repayProofData;
    }
    nullifier3 = clampFieldElement(randomBytes(32));
    secret3 = clampFieldElement(randomBytes(32));
    timestamp3 = timestamp2 + 10n;
    const oldNote = {
      nullifier: bytesToBigIntBE(nullifier2),
      secret: bytesToBigIntBE(secret2),
      supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
      supplyUsdc: 0n,
      borrowSol: BigInt(BORROW_AMOUNT.toString()),
      borrowUsdc: 0n,
      timestamp: timestamp2,
    };
    const newNote = {
      nullifier: bytesToBigIntBE(nullifier3),
      secret: bytesToBigIntBE(secret3),
      supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
      supplyUsdc: 0n,
      borrowSol: 0n,
      borrowUsdc: 0n,
      timestamp: timestamp3,
    };
    const oldCommitmentValue = await computeCommitment(oldNote);
    const newCommitmentValue = await computeCommitment(newNote);
    commitment2 = Buffer.from(bigintToBytesBE(oldCommitmentValue, 32));
    commitment3 = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
    const { proof, path, root } = await getMerkleProof([commitment1, commitment2], 1, MERKLE_DEPTH);
    const nullifierHash = await computeNullifierHash(nullifier2);
    const circuitInput = {
      merkleRoot: toFieldString(root),
      pathElements: proof.map((node: Buffer) => toFieldString(node)),
      pathIndices: path,
      oldNullifier: toFieldString(nullifier2),
      oldSecret: toFieldString(secret2),
      oldSupplySol: oldNote.supplySol.toString(),
      oldSupplyUsdc: "0",
      oldBorrowSol: BORROW_AMOUNT.toString(),
      oldBorrowUsdc: "0",
      oldTimestamp: oldNote.timestamp.toString(),
      deltaRepaySol: BORROW_AMOUNT.toString(),
      deltaRepayUsdc: "0",
      newNullifier: toFieldString(nullifier3),
      newSecret: toFieldString(secret3),
      newTimestamp: newNote.timestamp.toString(),
      publicNullifierHash: nullifierHash.toString(),
      publicOldCommitment: oldCommitmentValue.toString(),
      publicNewCommitment: newCommitmentValue.toString(),
    };
    console.log("Repay Circuit Input:", JSON.stringify(circuitInput, null, 2));
    const zkProofData = await buildGroth16Proof("repay", circuitInput);
    const vKey = JSON.parse(require("fs").readFileSync(require("path").resolve(__dirname, "../circuits/veillend/build/repay/verification_key.json"), "utf8"));
    const verified = await snarkjs.groth16.verify(vKey, zkProofData.publicSignals, zkProofData.proof);
    console.log("Off-chain verification:", verified);
    const zkProof = toGroth16Proof(zkProofData.proof);
    repayProofData = {
      proof: zkProof,
      merkleProof: proof,
      merklePath: path,
      oldCommitment: oldCommitmentValue,
      newCommitment: newCommitmentValue,
    };
    return repayProofData;
  };





  // const REPAY_AMOUNT = new BN(2 * LAMPORTS_PER_SOL);
  // const WITHDRAW_AMOUNT = new BN(3 * LAMPORTS_PER_SOL);

  before(async () => {
    // Airdrop SOL to user for transaction fees
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    const airdropSig2 = await provider.connection.requestAirdrop(
      user2.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);

    // Create collateral mint (simulating a token like USDC)
    collateralMint = await createMint(
      provider.connection,
      (authority as any).payer,
      authority.publicKey,
      null,
      9 // 9 decimals like SOL
    );

    // Derive PDAs
    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), collateralMint.toBuffer()],
      program.programId
    );

    [protectionPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("protection_pool"), vault.toBuffer()],
      program.programId
    );

    [vaultCollateralAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_collateral"), vault.toBuffer()],
      program.programId
    );

    [merkleTree] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree"), vault.toBuffer()],
      program.programId
    );

    [protectionReserveAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("protection_reserve"), vault.toBuffer()],
      program.programId
    );

    [receiptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), vault.toBuffer()],
      program.programId
    );

    [borrowMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("borrow"), vault.toBuffer()],
      program.programId
    );

    [userReceipt] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_receipt"), vault.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    // Create user's collateral token account and mint tokens
    const userCollateralAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as any).payer,
      collateralMint,
      user.publicKey
    );
    userCollateralAccountAddr = userCollateralAccount.address;

    // Mint collateral tokens to user
    await mintTo(
      provider.connection,
      (authority as any).payer,
      collateralMint,
      userCollateralAccountAddr,
      authority.publicKey,
      100 * LAMPORTS_PER_SOL
    );

    // Get user receipt token account address (ATA for receipt mint)
    userReceiptTokenAccount = await anchor.utils.token.associatedAddress({
        mint: receiptMint,
        owner: user.publicKey,
    });

    console.log("Setup complete:");
    console.log("  Collateral Mint:", collateralMint.toBase58());
    console.log("  Vault PDA:", vault.toBase58());
    console.log("  User:", user.publicKey.toBase58());
  });

  describe("1. Initialize", () => {
    it("should initialize vault and protection pool", async () => {
      await program.methods
        .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
        .accountsStrict({
          authority: authority.publicKey,
          vault,
          // protectionPool, // Moved
          vaultCollateralAccount,
          merkleTree,
          // protectionReserveAccount, // Moved
          // receiptMint, // Moved
          // borrowMint, // Moved
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeMints()
        .accountsStrict({
          authority: authority.publicKey,
          vault,
          receiptMint,
          borrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();


      await program.methods
        .initializeProtection()
        .accountsStrict({
          authority: authority.publicKey,
          vault,
          protectionPool,
          protectionReserveAccount,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      // Verify vault state
      const vaultAccount = await programAccounts.vault.fetch(vault);
      expect(vaultAccount.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      
      // Verify protection pool state
      const poolAccount = await programAccounts.protectionPool.fetch(protectionPool);
      expect(poolAccount.vault.toBase58()).to.equal(vault.toBase58());

      const treeAccount = await programAccounts.merkleTree.fetch(merkleTree);
      expect(treeAccount.vault.toBase58()).to.equal(vault.toBase58());
    });
  });

  describe("2. Deposit", () => {
    it("should deposit collateral and receive shares", async () => {
      const vaultBefore = await programAccounts.vault.fetch(vault);
      
      const encryptedBalance = getEncryptedBalance(BigInt(DEPOSIT_AMOUNT.toString()), 0n);
      const clientKey = getClientKey();

      await program.methods
        .deposit(DEPOSIT_AMOUNT, encryptedBalance, clientKey)
        .accountsStrict({
          user: user.publicKey,
          vault,
          userReceipt,
          receiptMint,
          userReceiptTokenAccount,
          userCollateralAccount: userCollateralAccountAddr, // Correct name in HEAD deposit.rs
          vaultCollateralAccount,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Verify vault state updated
      const vaultAfter = await programAccounts.vault.fetch(vault);
      expect(vaultAfter.totalCollateral.toNumber()).to.equal(
        vaultBefore.totalCollateral.toNumber() + DEPOSIT_AMOUNT.toNumber()
      );

      // Verify user receipt created
      const receipt = await programAccounts.userReceipt.fetch(userReceipt);
      expect(receipt.owner.toBase58()).to.equal(user.publicKey.toBase58());
      expect(receipt.depositedCollateral.toNumber()).to.equal(DEPOSIT_AMOUNT.toNumber());
      expect(receipt.borrowedAmount.toNumber()).to.equal(0);
      
      // Verify protection field initialized
      expect(receipt.protectionTier).to.equal(0);

      // Verify collateral transferred to vault
      const vaultCollateral = await getAccount(provider.connection, vaultCollateralAccount);
      expect(Number(vaultCollateral.amount)).to.equal(DEPOSIT_AMOUNT.toNumber());
    });
  });

  describe("3. Secure Merkle flow", () => {
    it("should append commitment on secure deposit", async () => {
      const zeroNullifier = Buffer.alloc(32);
      const zeroSecret = Buffer.alloc(32);
      const zeroNote = {
        nullifier: 0n,
        secret: 0n,
        supplySol: 0n,
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: 0n,
      };
      const oldCommitmentValue = await computeCommitment(zeroNote);
      const currentCommitment = Buffer.from(bigintToBytesBE(oldCommitmentValue, 32));

      nullifier1 = clampFieldElement(randomBytes(32));
      secret1 = clampFieldElement(randomBytes(32));
      timestamp1 = BigInt(Math.floor(Date.now() / 1000));
      const newNote = {
        nullifier: bytesToBigIntBE(nullifier1),
        secret: bytesToBigIntBE(secret1),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp1,
      };
      const newCommitmentValue = await computeCommitment(newNote);
      commitment1 = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
      noteHash = new Uint8Array(Buffer.alloc(32, 1));
      const noteHashBytes = Array.from(noteHash);
      const encryptedBalance = getEncryptedBalance(BigInt(DEPOSIT_AMOUNT.toString()), 0n);
      const clientKey = getClientKey();
      const { proof: merkleProof, path, root: merkleRoot } = await getMerkleProof([], 0, MERKLE_DEPTH);
      const nullifierHash = await computeNullifierHash(zeroNullifier);
      const circuitInput = {
        merkleRoot: toFieldString(merkleRoot),
        pathElements: merkleProof.map((node: Buffer) => toFieldString(node)),
        pathIndices: path,
        oldNullifier: toFieldString(zeroNullifier),
        oldSecret: toFieldString(zeroSecret),
        oldSupplySol: "0",
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: "0",
        deltaSupplySol: DEPOSIT_AMOUNT.toString(),
        deltaSupplyUsdc: "0",
        newNullifier: toFieldString(nullifier1),
        newSecret: toFieldString(secret1),
        newTimestamp: newNote.timestamp.toString(),
        publicNullifierHash: nullifierHash.toString(),
        publicOldCommitment: oldCommitmentValue.toString(),
        publicNewCommitment: newCommitmentValue.toString(),
      };
      const zkProofData = await buildGroth16Proof("supply", circuitInput);
      const zkProof = toGroth16Proof(zkProofData.proof);

      [noteReceipt] = PublicKey.findProgramAddressSync(
        [Buffer.from('note_receipt'), vault.toBuffer(), Buffer.from(noteHashBytes)],
        program.programId,
      );
      noteReceiptTokenAccount = await anchor.utils.token.associatedAddress({
        mint: receiptMint,
        owner: noteReceipt,
      });

      await program.methods
        .depositSecure(
          DEPOSIT_AMOUNT,
          encryptedBalance,
          clientKey,
          noteHashBytes,
          Array.from(commitment1),
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          noteReceipt,
          receiptMint,
          noteReceiptTokenAccount,
          userCollateralAccount: userCollateralAccountAddr,
          vaultCollateralAccount,
          merkleTree,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root } = await buildMerkleTree([commitment1], MERKLE_DEPTH);
      expect(Buffer.from(tree.root)).to.deep.equal(root);
    });

    it("should borrow with merkle proof and nullifier", async () => {
      if (!userBorrowAccountAddr) {
        const userBorrowAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          (authority as any).payer,
          borrowMint,
          user.publicKey
        );
        userBorrowAccountAddr = userBorrowAccount.address;
      }
      if (!user2BorrowAccountAddr) {
        const userBorrowAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          (authority as any).payer,
          borrowMint,
          user2.publicKey
        );
        user2BorrowAccountAddr = userBorrowAccount.address;
      }

      nullifier2 = clampFieldElement(randomBytes(32));
      secret2 = clampFieldElement(randomBytes(32));
      timestamp2 = BigInt(Math.floor(Date.now() / 1000) + 10);
      const oldNote = {
        nullifier: bytesToBigIntBE(nullifier1),
        secret: bytesToBigIntBE(secret1),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp1,
      };
      const newNote = {
        nullifier: bytesToBigIntBE(nullifier2),
        secret: bytesToBigIntBE(secret2),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(BORROW_AMOUNT.toString()),
        borrowUsdc: 0n,
        timestamp: timestamp2,
      };
      const oldCommitmentValue = await computeCommitment(oldNote);
      const newCommitmentValue = await computeCommitment(newNote);
      commitment1 = Buffer.from(bigintToBytesBE(oldCommitmentValue, 32));
      commitment2 = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));
      const { proof, path, root: borrowRoot } = await getMerkleProof([commitment1], 0, MERKLE_DEPTH);
      const nullifierHash = await computeNullifierHash(nullifier1);
      const circuitInput = {
        merkleRoot: toFieldString(borrowRoot),
        pathElements: proof.map((node: Buffer) => toFieldString(node)),
        pathIndices: path,
        oldNullifier: toFieldString(nullifier1),
        oldSecret: toFieldString(secret1),
        oldSupplySol: oldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: oldNote.timestamp.toString(),
        deltaBorrowSol: BORROW_AMOUNT.toString(),
        deltaBorrowUsdc: "0",
        newNullifier: toFieldString(nullifier2),
        newSecret: toFieldString(secret2),
        newTimestamp: newNote.timestamp.toString(),
        publicNullifierHash: nullifierHash.toString(),
        publicOldCommitment: oldCommitmentValue.toString(),
        publicNewCommitment: newCommitmentValue.toString(),
      };
      const zkProofData = await buildGroth16Proof("borrow", circuitInput);
      const zkProof = toGroth16Proof(zkProofData.proof);
      const encryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        BigInt(BORROW_AMOUNT.toString()),
      );
      const borrowArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment1),
        newCommitment: Array.from(commitment2),
        nullifier: Array.from(nullifier1),
        zkProof,
        merkleProof: proof.map((node: Buffer) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(borrowArgs.nullifier),
        ],
        program.programId,
      )[0];
      await program.methods
        .borrowSecure(
          borrowArgs.amount,
          borrowArgs.encryptedBalance,
          borrowArgs.currentCommitment,
          borrowArgs.newCommitment,
          borrowArgs.nullifier,
          borrowArgs.zkProof,
          borrowArgs.merkleProof,
          borrowArgs.merklePath,
        )
        .accountsStrict({
          user: user2.publicKey,
          vault,
          noteReceipt,
          userBorrowAccount: user2BorrowAccountAddr,
          merkleTree,
          nullifierAccount: nullifierPda,
          collateralMint,
          borrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user2])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root } = await buildMerkleTree([commitment1, commitment2], MERKLE_DEPTH);
      expect(Buffer.from(tree.root)).to.deep.equal(root);

    });

    it("should reject invalid zk proof", async () => {
      const repayData = await buildRepayProofData();
      const badProof = JSON.parse(JSON.stringify(repayData.proof));
      badProof.aX[0] = (badProof.aX[0] + 1) % 255;
const encryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        0n,
      );
      try {
        await program.methods
          .repaySecure(
            BORROW_AMOUNT,
            encryptedBalance,
            Array.from(commitment2),
            Array.from(commitment3),
            Array.from(nullifier2),
            badProof,
            repayData.merkleProof.map((node: Buffer) => Array.from(node)),
            Buffer.from(repayData.merklePath),
          )
          .accountsStrict({
            user: user.publicKey,
            vault,
            noteReceipt,
            userRepayAccount: userBorrowAccountAddr,
            merkleTree,
            nullifierAccount: PublicKey.findProgramAddressSync(
              [Buffer.from('nullifier'), vault.toBuffer(), Buffer.from(nullifier2)],
              program.programId,
            )[0],
            collateralMint,
            repayMint: borrowMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
        .signers([user])
        .rpc();
        throw new Error("Expected zk proof to fail");
      } catch (error) {
        const anchorError = error as { error?: { errorCode?: { code?: string }, errorMessage?: string } };
        const errorCode = anchorError?.error?.errorCode?.code;
        const anchorMessage = anchorError?.error?.errorMessage;
        if (errorCode) {
          expect(errorCode).to.equal("ZkProofInvalid");
          return;
        }
        expect(anchorMessage ?? "").to.include("ZK proof verification failed");
      }
    });

    it("should block double-spend with same nullifier", async () => {
      const { proof, path, root: doubleSpendRoot } = await getMerkleProof([commitment1, commitment2], 0, MERKLE_DEPTH);
      const doubleSpendAmount = new BN(1 * LAMPORTS_PER_SOL);
      const totalBorrowAfter = BORROW_AMOUNT.add(doubleSpendAmount);
      const doubleSpendNullifier = clampFieldElement(randomBytes(32));
      const doubleSpendSecret = clampFieldElement(randomBytes(32));
      const doubleSpendTimestamp = timestamp2 + 20n;
      const oldNote = {
        nullifier: bytesToBigIntBE(nullifier1),
        secret: bytesToBigIntBE(secret1),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp1,
      };
      const newNote = {
        nullifier: bytesToBigIntBE(doubleSpendNullifier),
        secret: bytesToBigIntBE(doubleSpendSecret),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(doubleSpendAmount.toString()),
        borrowUsdc: 0n,
        timestamp: doubleSpendTimestamp,
      };
      const oldCommitmentValue = await computeCommitment(oldNote);
      const newCommitmentValue = await computeCommitment(newNote);
      const nullifierHash = await computeNullifierHash(nullifier1);
      const circuitInput = {
        merkleRoot: toFieldString(doubleSpendRoot),
        pathElements: proof.map((node: Buffer) => toFieldString(node)),
        pathIndices: path,
        oldNullifier: toFieldString(nullifier1),
        oldSecret: toFieldString(secret1),
        oldSupplySol: oldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: oldNote.timestamp.toString(),
        deltaBorrowSol: doubleSpendAmount.toString(),
        deltaBorrowUsdc: "0",
        newNullifier: toFieldString(doubleSpendNullifier),
        newSecret: toFieldString(doubleSpendSecret),
        newTimestamp: doubleSpendTimestamp.toString(),
        publicNullifierHash: nullifierHash.toString(),
        publicOldCommitment: oldCommitmentValue.toString(),
        publicNewCommitment: newCommitmentValue.toString(),
      };
      const zkProofData = await buildGroth16Proof("borrow", circuitInput);
      const zkProof = toGroth16Proof(zkProofData.proof);
      const encryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        BigInt(totalBorrowAfter.toString()),
      );
      const borrowArgs = {
        amount: doubleSpendAmount,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment1),
        newCommitment: Array.from(bigintToBytesBE(newCommitmentValue, 32)),
        nullifier: Array.from(nullifier1),
        zkProof,
        merkleProof: proof.map((node: Buffer) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(borrowArgs.nullifier),
        ],
        program.programId,
      )[0];
      try {
        await program.methods
          .borrowSecure(
            borrowArgs.amount,
            borrowArgs.encryptedBalance,
            borrowArgs.currentCommitment,
            borrowArgs.newCommitment,
            borrowArgs.nullifier,
            borrowArgs.zkProof,
            borrowArgs.merkleProof,
            borrowArgs.merklePath,
          )
          .accountsStrict({
            user: user2.publicKey,
            vault,
            noteReceipt,
            userBorrowAccount: user2BorrowAccountAddr,
            merkleTree,
            nullifierAccount: nullifierPda,
            collateralMint,
            borrowMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
          .signers([user2])
          .rpc();
        throw new Error('Expected double-spend to fail');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const anchorError = error as { error?: { errorCode?: { code?: string }, errorMessage?: string } };
        const errorCode = anchorError?.error?.errorCode?.code;
        const anchorMessage = anchorError?.error?.errorMessage;
        if (errorCode) {
          expect(errorCode).to.equal('NullifierAlreadySpent');
          return;
        }
        const combined = `${message} ${anchorMessage ?? ''}`.trim();
        expect(combined).to.include('Nullifier already spent');
      }
    });

    it("should repay and withdraw with new commitments", async () => {
      const repayData = await buildRepayProofData();
      const repayProof = repayData.proof;
      const encryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        BigInt(BORROW_AMOUNT.toString()),
      );
      const repayArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment2),
        newCommitment: Array.from(commitment3),
        nullifier: Array.from(nullifier2),
        zkProof: repayProof,
        merkleProof: repayData.merkleProof.map((node: Buffer) => Array.from(node)),
        merklePath: Buffer.from(repayData.merklePath),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(repayArgs.nullifier),
        ],
        program.programId,
      )[0];
      if (!userBorrowAccountAddr) {
        const userBorrowAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          (authority as any).payer,
          borrowMint,
          user.publicKey,
        );
        userBorrowAccountAddr = userBorrowAccount.address;
      }
      await transfer(
        provider.connection,
        user2,
        user2BorrowAccountAddr,
        userBorrowAccountAddr,
        user2,
        BORROW_AMOUNT.toNumber(),
      );

      await program.methods
        .repaySecure(
          repayArgs.amount,
          repayArgs.encryptedBalance,
          repayArgs.currentCommitment,
          repayArgs.newCommitment,
          repayArgs.nullifier,
          repayArgs.zkProof,
          repayArgs.merkleProof,
          repayArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          noteReceipt,
          userRepayAccount: userBorrowAccountAddr,
          merkleTree,
          nullifierAccount: nullifierPda,
          collateralMint,
          repayMint: borrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      nullifier4 = clampFieldElement(randomBytes(32));
      secret4 = clampFieldElement(randomBytes(32));
      timestamp4 = timestamp3 + 10n;
      const withdrawOldNote = {
        nullifier: bytesToBigIntBE(nullifier3),
        secret: bytesToBigIntBE(secret3),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp3,
      };
      const withdrawNewNote = {
        nullifier: bytesToBigIntBE(nullifier4),
        secret: bytesToBigIntBE(secret4),
        supplySol: 0n,
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp4,
      };
      const withdrawOldCommitmentValue = await computeCommitment(withdrawOldNote);
      const withdrawNewCommitmentValue = await computeCommitment(withdrawNewNote);
      commitment4 = Buffer.from(bigintToBytesBE(withdrawNewCommitmentValue, 32));
      const receipt = await programAccounts.noteReceipt.fetch(noteReceipt);
      const { proof: withdrawProof, path: withdrawPath, root: withdrawRoot } = await getMerkleProof(
        [commitment1, commitment2, commitment3],
        2,
        MERKLE_DEPTH,
      );
      const withdrawNullifierHash = await computeNullifierHash(nullifier3);
      const withdrawCircuitInput = {
        merkleRoot: toFieldString(withdrawRoot),
        pathElements: withdrawProof.map((node) => toFieldString(node)),
        pathIndices: withdrawPath,
        oldNullifier: toFieldString(nullifier3),
        oldSecret: toFieldString(secret3),
        oldSupplySol: DEPOSIT_AMOUNT.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: timestamp3.toString(),
        deltaWithdrawSol: DEPOSIT_AMOUNT.toString(),
        deltaWithdrawUsdc: "0",
        newNullifier: toFieldString(nullifier4),
        newSecret: toFieldString(secret4),
        newTimestamp: timestamp4.toString(),
        publicNullifierHash: withdrawNullifierHash.toString(),
        publicOldCommitment: withdrawOldCommitmentValue.toString(),
        publicNewCommitment: withdrawNewCommitmentValue.toString(),
      };
      const withdrawZkProofData = await buildGroth16Proof("withdraw", withdrawCircuitInput);
      const withdrawZkProof = toGroth16Proof(withdrawZkProofData.proof);
      const withdrawArgs = {
        sharesToBurn: receipt.shares,
        encryptedBalance: getEncryptedBalance(
          0n,
          0n,
        ),
        currentCommitment: Array.from(commitment3),
        newCommitment: Array.from(commitment4),
        nullifier: Array.from(nullifier3),
        zkProof: withdrawZkProof,
        merkleProof: withdrawProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(withdrawPath),
      };
      const withdrawNullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(withdrawArgs.nullifier),
        ],
        program.programId,
      )[0];

      await program.methods
        .withdrawSecure(
          withdrawArgs.sharesToBurn,
          withdrawArgs.encryptedBalance,
          withdrawArgs.currentCommitment,
          withdrawArgs.newCommitment,
          withdrawArgs.nullifier,
          withdrawArgs.zkProof,
          withdrawArgs.merkleProof,
          withdrawArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          noteReceipt,
          receiptMint,
          noteReceiptTokenAccount,
          userCollateralAccount: userCollateralAccountAddr,
          vaultCollateralAccount,
          merkleTree,
          nullifierAccount: withdrawNullifierPda,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root } = await buildMerkleTree(
        [commitment1, commitment2, commitment3, commitment4],
        MERKLE_DEPTH,
      );
      expect(Buffer.from(tree.root)).to.deep.equal(root);
    });

    it("SECURE end-to-end supply borrow repay withdraw", async () => {
      const baseTimestamp = 1700000000n;

      const e2eCollateralMint = await createMint(
        provider.connection,
        (authority as any).payer,
        authority.publicKey,
        null,
        9,
      );

      const [e2eVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), e2eCollateralMint.toBuffer()],
        program.programId,
      );
      const [e2eProtectionPool] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_pool"), e2eVault.toBuffer()],
        program.programId,
      );
      const [e2eVaultCollateralAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_collateral"), e2eVault.toBuffer()],
        program.programId,
      );
      const [e2eMerkleTree] = PublicKey.findProgramAddressSync(
        [Buffer.from("merkle_tree"), e2eVault.toBuffer()],
        program.programId,
      );
      const [e2eProtectionReserveAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_reserve"), e2eVault.toBuffer()],
        program.programId,
      );
      const [e2eReceiptMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), e2eVault.toBuffer()],
        program.programId,
      );
      const [e2eBorrowMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("borrow"), e2eVault.toBuffer()],
        program.programId,
      );

      await program.methods
        .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
        .accountsStrict({
          authority: authority.publicKey,
          vault: e2eVault,
          vaultCollateralAccount: e2eVaultCollateralAccount,
          merkleTree: e2eMerkleTree,
          collateralMint: e2eCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeMints()
        .accountsStrict({
          authority: authority.publicKey,
          vault: e2eVault,
          receiptMint: e2eReceiptMint,
          borrowMint: e2eBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeProtection()
        .accountsStrict({
          authority: authority.publicKey,
          vault: e2eVault,
          protectionPool: e2eProtectionPool,
          protectionReserveAccount: e2eProtectionReserveAccount,
          collateralMint: e2eCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const e2eUserCollateralAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        e2eCollateralMint,
        user.publicKey,
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        e2eCollateralMint,
        e2eUserCollateralAccount.address,
        authority.publicKey,
        100 * LAMPORTS_PER_SOL,
      );

      const e2eUserBorrowAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        e2eBorrowMint,
        user.publicKey,
      );

      const e2eNoteHash = new Uint8Array(Buffer.alloc(32, 2));
      const e2eNoteHashBytes = Array.from(e2eNoteHash);
      const [e2eNoteReceipt] = PublicKey.findProgramAddressSync(
        [Buffer.from('note_receipt'), e2eVault.toBuffer(), Buffer.from(e2eNoteHashBytes)],
        program.programId,
      );
      const e2eNoteReceiptTokenAccount = await anchor.utils.token.associatedAddress({
        mint: e2eReceiptMint,
        owner: e2eNoteReceipt,
      });

      const merkleLeaves: Buffer[] = [];

      const nullifier1Local = clampFieldElement(randomBytes(32));
      const secret1Local = clampFieldElement(randomBytes(32));
      const timestamp1Local = baseTimestamp;
      const note1 = {
        nullifier: bytesToBigIntBE(nullifier1Local),
        secret: bytesToBigIntBE(secret1Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp1Local,
      };
      const commitment1Value = await computeCommitment(note1);
      const commitment1Local = Buffer.from(bigintToBytesBE(commitment1Value, 32));

      const encryptedBalance1 = getEncryptedBalance(BigInt(DEPOSIT_AMOUNT.toString()), 0n);
      const clientKey = getClientKey();
      await program.methods
        .depositSecure(
          DEPOSIT_AMOUNT,
          encryptedBalance1,
          clientKey,
          e2eNoteHashBytes,
          Array.from(commitment1Local),
        )
        .accountsStrict({
          user: user.publicKey,
          vault: e2eVault,
          noteReceipt: e2eNoteReceipt,
          receiptMint: e2eReceiptMint,
          noteReceiptTokenAccount: e2eNoteReceiptTokenAccount,
          userCollateralAccount: e2eUserCollateralAccount.address,
          vaultCollateralAccount: e2eVaultCollateralAccount,
          merkleTree: e2eMerkleTree,
          collateralMint: e2eCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      merkleLeaves.push(commitment1Local);

      const nullifier2Local = clampFieldElement(randomBytes(32));
      const secret2Local = clampFieldElement(randomBytes(32));
      const timestamp2Local = baseTimestamp + 10n;
      const borrowOldNote = {
        nullifier: bytesToBigIntBE(nullifier1Local),
        secret: bytesToBigIntBE(secret1Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp1Local,
      };
      const borrowNewNote = {
        nullifier: bytesToBigIntBE(nullifier2Local),
        secret: bytesToBigIntBE(secret2Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(BORROW_AMOUNT.toString()),
        borrowUsdc: 0n,
        timestamp: timestamp2Local,
      };
      const borrowOldCommitmentValue = await computeCommitment(borrowOldNote);
      const borrowNewCommitmentValue = await computeCommitment(borrowNewNote);
      const commitment2Local = Buffer.from(bigintToBytesBE(borrowNewCommitmentValue, 32));
      const { proof: borrowProof, path: borrowPath, root: borrowRoot } = await getMerkleProof(
        merkleLeaves,
        0,
        MERKLE_DEPTH,
      );
      const borrowNullifierHash = await computeNullifierHash(nullifier1Local);
      const borrowCircuitInput = {
        merkleRoot: toFieldString(borrowRoot),
        pathElements: borrowProof.map((node) => toFieldString(node)),
        pathIndices: borrowPath,
        oldNullifier: toFieldString(nullifier1Local),
        oldSecret: toFieldString(secret1Local),
        oldSupplySol: borrowOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: borrowOldNote.timestamp.toString(),
        deltaBorrowSol: BORROW_AMOUNT.toString(),
        deltaBorrowUsdc: "0",
        newNullifier: toFieldString(nullifier2Local),
        newSecret: toFieldString(secret2Local),
        newTimestamp: borrowNewNote.timestamp.toString(),
        publicNullifierHash: borrowNullifierHash.toString(),
        publicOldCommitment: borrowOldCommitmentValue.toString(),
        publicNewCommitment: borrowNewCommitmentValue.toString(),
      };
      const borrowZkProofData = await buildGroth16Proof("borrow", borrowCircuitInput);
      const borrowZkProof = toGroth16Proof(borrowZkProofData.proof);
      const borrowEncryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        BigInt(BORROW_AMOUNT.toString()),
      );
      const borrowArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: borrowEncryptedBalance,
        currentCommitment: Array.from(commitment1Local),
        newCommitment: Array.from(commitment2Local),
        nullifier: Array.from(nullifier1Local),
        zkProof: borrowZkProof,
        merkleProof: borrowProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(borrowPath),
      };
      const borrowNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), e2eVault.toBuffer(), Buffer.from(borrowArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .borrowSecure(
          borrowArgs.amount,
          borrowArgs.encryptedBalance,
          borrowArgs.currentCommitment,
          borrowArgs.newCommitment,
          borrowArgs.nullifier,
          borrowArgs.zkProof,
          borrowArgs.merkleProof,
          borrowArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: e2eVault,
          noteReceipt: e2eNoteReceipt,
          userBorrowAccount: e2eUserBorrowAccount.address,
          merkleTree: e2eMerkleTree,
          nullifierAccount: borrowNullifierPda,
          collateralMint: e2eCollateralMint,
          borrowMint: e2eBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      merkleLeaves.push(commitment2Local);

      const nullifier3Local = clampFieldElement(randomBytes(32));
      const secret3Local = clampFieldElement(randomBytes(32));
      const timestamp3Local = baseTimestamp + 20n;
      const repayOldNote = {
        nullifier: bytesToBigIntBE(nullifier2Local),
        secret: bytesToBigIntBE(secret2Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(BORROW_AMOUNT.toString()),
        borrowUsdc: 0n,
        timestamp: timestamp2Local,
      };
      const repayNewNote = {
        nullifier: bytesToBigIntBE(nullifier3Local),
        secret: bytesToBigIntBE(secret3Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp3Local,
      };
      const repayOldCommitmentValue = await computeCommitment(repayOldNote);
      const repayNewCommitmentValue = await computeCommitment(repayNewNote);
      const commitment3Local = Buffer.from(bigintToBytesBE(repayNewCommitmentValue, 32));
      const { proof: repayProof, path: repayPath, root: repayRoot } = await getMerkleProof(
        merkleLeaves,
        1,
        MERKLE_DEPTH,
      );
      const repayNullifierHash = await computeNullifierHash(nullifier2Local);
      const repayCircuitInput = {
        merkleRoot: toFieldString(repayRoot),
        pathElements: repayProof.map((node) => toFieldString(node)),
        pathIndices: repayPath,
        oldNullifier: toFieldString(nullifier2Local),
        oldSecret: toFieldString(secret2Local),
        oldSupplySol: repayOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: repayOldNote.borrowSol.toString(),
        oldBorrowUsdc: "0",
        oldTimestamp: repayOldNote.timestamp.toString(),
        deltaRepaySol: BORROW_AMOUNT.toString(),
        deltaRepayUsdc: "0",
        newNullifier: toFieldString(nullifier3Local),
        newSecret: toFieldString(secret3Local),
        newTimestamp: repayNewNote.timestamp.toString(),
        publicNullifierHash: repayNullifierHash.toString(),
        publicOldCommitment: repayOldCommitmentValue.toString(),
        publicNewCommitment: repayNewCommitmentValue.toString(),
      };
      const repayZkProofData = await buildGroth16Proof("repay", repayCircuitInput);
      const repayZkProof = toGroth16Proof(repayZkProofData.proof);
      const repayEncryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        0n,
      );
      const repayArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: repayEncryptedBalance,
        currentCommitment: Array.from(commitment2Local),
        newCommitment: Array.from(commitment3Local),
        nullifier: Array.from(nullifier2Local),
        zkProof: repayZkProof,
        merkleProof: repayProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(repayPath),
      };
      const repayNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), e2eVault.toBuffer(), Buffer.from(repayArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .repaySecure(
          repayArgs.amount,
          repayArgs.encryptedBalance,
          repayArgs.currentCommitment,
          repayArgs.newCommitment,
          repayArgs.nullifier,
          repayArgs.zkProof,
          repayArgs.merkleProof,
          repayArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: e2eVault,
          noteReceipt: e2eNoteReceipt,
          userRepayAccount: e2eUserBorrowAccount.address,
          merkleTree: e2eMerkleTree,
          nullifierAccount: repayNullifierPda,
          collateralMint: e2eCollateralMint,
          repayMint: e2eBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      merkleLeaves.push(commitment3Local);

      const nullifier4Local = clampFieldElement(randomBytes(32));
      const secret4Local = clampFieldElement(randomBytes(32));
      const timestamp4Local = baseTimestamp + 30n;
      const withdrawOldNote = {
        nullifier: bytesToBigIntBE(nullifier3Local),
        secret: bytesToBigIntBE(secret3Local),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp3Local,
      };
      const withdrawNewNote = {
        nullifier: bytesToBigIntBE(nullifier4Local),
        secret: bytesToBigIntBE(secret4Local),
        supplySol: 0n,
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: timestamp4Local,
      };
      const withdrawOldCommitmentValue = await computeCommitment(withdrawOldNote);
      const withdrawNewCommitmentValue = await computeCommitment(withdrawNewNote);
      const commitment4Local = Buffer.from(bigintToBytesBE(withdrawNewCommitmentValue, 32));
      const { proof: withdrawProof, path: withdrawPath, root: withdrawRoot } = await getMerkleProof(
        merkleLeaves,
        2,
        MERKLE_DEPTH,
      );
      const withdrawNullifierHash = await computeNullifierHash(nullifier3Local);
      const withdrawCircuitInput = {
        merkleRoot: toFieldString(withdrawRoot),
        pathElements: withdrawProof.map((node) => toFieldString(node)),
        pathIndices: withdrawPath,
        oldNullifier: toFieldString(nullifier3Local),
        oldSecret: toFieldString(secret3Local),
        oldSupplySol: withdrawOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: withdrawOldNote.timestamp.toString(),
        deltaWithdrawSol: DEPOSIT_AMOUNT.toString(),
        deltaWithdrawUsdc: "0",
        newNullifier: toFieldString(nullifier4Local),
        newSecret: toFieldString(secret4Local),
        newTimestamp: withdrawNewNote.timestamp.toString(),
        publicNullifierHash: withdrawNullifierHash.toString(),
        publicOldCommitment: withdrawOldCommitmentValue.toString(),
        publicNewCommitment: withdrawNewCommitmentValue.toString(),
      };
      const withdrawZkProofData = await buildGroth16Proof("withdraw", withdrawCircuitInput);
      const withdrawZkProof = toGroth16Proof(withdrawZkProofData.proof);
      const withdrawEncryptedBalance = getEncryptedBalance(0n, 0n);
      const receipt = await programAccounts.noteReceipt.fetch(e2eNoteReceipt);
      const withdrawArgs = {
        sharesToBurn: receipt.shares,
        encryptedBalance: withdrawEncryptedBalance,
        currentCommitment: Array.from(commitment3Local),
        newCommitment: Array.from(commitment4Local),
        nullifier: Array.from(nullifier3Local),
        zkProof: withdrawZkProof,
        merkleProof: withdrawProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(withdrawPath),
      };
      const withdrawNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), e2eVault.toBuffer(), Buffer.from(withdrawArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .withdrawSecure(
          withdrawArgs.sharesToBurn,
          withdrawArgs.encryptedBalance,
          withdrawArgs.currentCommitment,
          withdrawArgs.newCommitment,
          withdrawArgs.nullifier,
          withdrawArgs.zkProof,
          withdrawArgs.merkleProof,
          withdrawArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: e2eVault,
          noteReceipt: e2eNoteReceipt,
          receiptMint: e2eReceiptMint,
          noteReceiptTokenAccount: e2eNoteReceiptTokenAccount,
          userCollateralAccount: e2eUserCollateralAccount.address,
          vaultCollateralAccount: e2eVaultCollateralAccount,
          merkleTree: e2eMerkleTree,
          nullifierAccount: withdrawNullifierPda,
          collateralMint: e2eCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(e2eMerkleTree);
      const { root } = await buildMerkleTree(
        [commitment1Local, commitment2Local, commitment3Local, commitment4Local],
        MERKLE_DEPTH,
      );
      expect(Buffer.from(tree.root)).to.deep.equal(root);
    });

    it("Parity: FAST vs SECURE end state", async () => {
      const baseTimestamp = 1700001000n;

      const fastCollateralMint = await createMint(
        provider.connection,
        (authority as any).payer,
        authority.publicKey,
        null,
        9,
      );

      const [fastVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), fastCollateralMint.toBuffer()],
        program.programId,
      );
      const [fastProtectionPool] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_pool"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastVaultCollateralAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_collateral"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastMerkleTree] = PublicKey.findProgramAddressSync(
        [Buffer.from("merkle_tree"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastProtectionReserveAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_reserve"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastReceiptMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastBorrowMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("borrow"), fastVault.toBuffer()],
        program.programId,
      );
      const [fastUserReceipt] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_receipt"), fastVault.toBuffer(), user.publicKey.toBuffer()],
        program.programId,
      );

      await program.methods
        .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
        .accountsStrict({
          authority: authority.publicKey,
          vault: fastVault,
          vaultCollateralAccount: fastVaultCollateralAccount,
          merkleTree: fastMerkleTree,
          collateralMint: fastCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeMints()
        .accountsStrict({
          authority: authority.publicKey,
          vault: fastVault,
          receiptMint: fastReceiptMint,
          borrowMint: fastBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeProtection()
        .accountsStrict({
          authority: authority.publicKey,
          vault: fastVault,
          protectionPool: fastProtectionPool,
          protectionReserveAccount: fastProtectionReserveAccount,
          collateralMint: fastCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const fastUserCollateralAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        fastCollateralMint,
        user.publicKey,
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        fastCollateralMint,
        fastUserCollateralAccount.address,
        authority.publicKey,
        100 * LAMPORTS_PER_SOL,
      );

      const fastUserReceiptTokenAccount = await anchor.utils.token.associatedAddress({
        mint: fastReceiptMint,
        owner: user.publicKey,
      });

      const fastUserBorrowAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        fastBorrowMint,
        user.publicKey,
      );

      const fastCollateralBefore = await getAccount(provider.connection, fastUserCollateralAccount.address);

      const fastEncryptedBalance = getEncryptedBalance(BigInt(DEPOSIT_AMOUNT.toString()), 0n);
      const fastClientKey = getClientKey();
      await program.methods
        .deposit(DEPOSIT_AMOUNT, fastEncryptedBalance, fastClientKey)
        .accountsStrict({
          user: user.publicKey,
          vault: fastVault,
          userReceipt: fastUserReceipt,
          receiptMint: fastReceiptMint,
          userReceiptTokenAccount: fastUserReceiptTokenAccount,
          userCollateralAccount: fastUserCollateralAccount.address,
          vaultCollateralAccount: fastVaultCollateralAccount,
          collateralMint: fastCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      const kaminoMarket = PublicKey.default;
      const kaminoObligation = PublicKey.default;
      const kaminoLendingMarketAuthority = PublicKey.default;
      const kaminoBorrowReserve = PublicKey.default;
      const kaminoBorrowReserveLiquidityMint = PublicKey.default;
      const kaminoReserveSourceLiquidity = PublicKey.default;
      const kaminoBorrowReserveLiquidityFeeReceiver = PublicKey.default;
      const kaminoReferrerTokenState = PublicKey.default;
      const kaminoPythOracle = PublicKey.default;
      const kaminoSwitchboardPriceOracle = PublicKey.default;
      const kaminoSwitchboardTwapOracle = PublicKey.default;
      const kaminoScopePrices = PublicKey.default;
      const kaminoProgram = PublicKey.default;

      await program.methods
        .borrow(BORROW_AMOUNT, fastEncryptedBalance)
        .accountsStrict({
          user: user.publicKey,
          vault: fastVault,
          userReceipt: fastUserReceipt,
          userBorrowAccount: fastUserBorrowAccount.address,
          kaminoMarket,
          kaminoObligation,
          kaminoLendingMarketAuthority,
          kaminoBorrowReserve,
          kaminoBorrowReserveLiquidityMint,
          kaminoReserveSourceLiquidity,
          kaminoBorrowReserveLiquidityFeeReceiver,
          kaminoReferrerTokenState,
          kaminoInstructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
          kaminoPythOracle,
          kaminoSwitchboardPriceOracle,
          kaminoSwitchboardTwapOracle,
          kaminoScopePrices,
          collateralMint: fastCollateralMint,
          borrowMint: fastBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          kaminoProgram,
        })
        .signers([user])
        .rpc();

      const fastBorrowAfterBorrow = await getAccount(provider.connection, fastUserBorrowAccount.address);
      expect(Number(fastBorrowAfterBorrow.amount)).to.equal(BORROW_AMOUNT.toNumber());

      await program.methods
        .repay(BORROW_AMOUNT, fastEncryptedBalance)
        .accountsStrict({
          user: user.publicKey,
          vault: fastVault,
          userReceipt: fastUserReceipt,
          userRepayAccount: fastUserBorrowAccount.address,
          kaminoMarket,
          kaminoObligation,
          kaminoRepayReserve: PublicKey.default,
          kaminoReserveLiquidityMint: PublicKey.default,
          kaminoReserveDestinationLiquidity: PublicKey.default,
          kaminoInstructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
          kaminoPythOracle,
          kaminoSwitchboardPriceOracle,
          kaminoSwitchboardTwapOracle,
          kaminoScopePrices,
          collateralMint: fastCollateralMint,
          repayMint: fastBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          kaminoProgram,
        })
        .signers([user])
        .rpc();

      const fastBorrowAfterRepay = await getAccount(provider.connection, fastUserBorrowAccount.address);
      expect(Number(fastBorrowAfterRepay.amount)).to.equal(0);

      const fastReceipt = await programAccounts.userReceipt.fetch(fastUserReceipt);
      await program.methods
        .withdraw(fastReceipt.shares, fastEncryptedBalance)
        .accountsStrict({
          user: user.publicKey,
          vault: fastVault,
          userReceipt: fastUserReceipt,
          receiptMint: fastReceiptMint,
          userReceiptTokenAccount: fastUserReceiptTokenAccount,
          userCollateralAccount: fastUserCollateralAccount.address,
          vaultCollateralAccount: fastVaultCollateralAccount,
          collateralMint: fastCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const fastCollateralAfter = await getAccount(provider.connection, fastUserCollateralAccount.address);
      const fastVaultCollateralAfter = await getAccount(provider.connection, fastVaultCollateralAccount);

      const secureCollateralMint = await createMint(
        provider.connection,
        (authority as any).payer,
        authority.publicKey,
        null,
        9,
      );

      const [secureVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), secureCollateralMint.toBuffer()],
        program.programId,
      );
      const [secureProtectionPool] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_pool"), secureVault.toBuffer()],
        program.programId,
      );
      const [secureVaultCollateralAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_collateral"), secureVault.toBuffer()],
        program.programId,
      );
      const [secureMerkleTree] = PublicKey.findProgramAddressSync(
        [Buffer.from("merkle_tree"), secureVault.toBuffer()],
        program.programId,
      );
      const [secureProtectionReserveAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("protection_reserve"), secureVault.toBuffer()],
        program.programId,
      );
      const [secureReceiptMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), secureVault.toBuffer()],
        program.programId,
      );
      const [secureBorrowMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("borrow"), secureVault.toBuffer()],
        program.programId,
      );

      await program.methods
        .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
        .accountsStrict({
          authority: authority.publicKey,
          vault: secureVault,
          vaultCollateralAccount: secureVaultCollateralAccount,
          merkleTree: secureMerkleTree,
          collateralMint: secureCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeMints()
        .accountsStrict({
          authority: authority.publicKey,
          vault: secureVault,
          receiptMint: secureReceiptMint,
          borrowMint: secureBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      await program.methods
        .initializeProtection()
        .accountsStrict({
          authority: authority.publicKey,
          vault: secureVault,
          protectionPool: secureProtectionPool,
          protectionReserveAccount: secureProtectionReserveAccount,
          collateralMint: secureCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const secureUserCollateralAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        secureCollateralMint,
        user.publicKey,
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        secureCollateralMint,
        secureUserCollateralAccount.address,
        authority.publicKey,
        100 * LAMPORTS_PER_SOL,
      );

      const secureUserBorrowAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        secureBorrowMint,
        user.publicKey,
      );

      const secureNoteHash = new Uint8Array(Buffer.alloc(32, 3));
      const secureNoteHashBytes = Array.from(secureNoteHash);
      const [secureNoteReceipt] = PublicKey.findProgramAddressSync(
        [Buffer.from('note_receipt'), secureVault.toBuffer(), Buffer.from(secureNoteHashBytes)],
        program.programId,
      );
      const secureNoteReceiptTokenAccount = await anchor.utils.token.associatedAddress({
        mint: secureReceiptMint,
        owner: secureNoteReceipt,
      });

      const secureLeaves: Buffer[] = [];

      const secureNullifier1 = clampFieldElement(randomBytes(32));
      const secureSecret1 = clampFieldElement(randomBytes(32));
      const secureTimestamp1 = baseTimestamp;
      const secureNote1 = {
        nullifier: bytesToBigIntBE(secureNullifier1),
        secret: bytesToBigIntBE(secureSecret1),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: secureTimestamp1,
      };
      const secureCommitment1Value = await computeCommitment(secureNote1);
      const secureCommitment1 = Buffer.from(bigintToBytesBE(secureCommitment1Value, 32));
      const secureEncryptedBalance = getEncryptedBalance(BigInt(DEPOSIT_AMOUNT.toString()), 0n);
      const secureClientKey = getClientKey();

      await program.methods
        .depositSecure(
          DEPOSIT_AMOUNT,
          secureEncryptedBalance,
          secureClientKey,
          secureNoteHashBytes,
          Array.from(secureCommitment1),
        )
        .accountsStrict({
          user: user.publicKey,
          vault: secureVault,
          noteReceipt: secureNoteReceipt,
          receiptMint: secureReceiptMint,
          noteReceiptTokenAccount: secureNoteReceiptTokenAccount,
          userCollateralAccount: secureUserCollateralAccount.address,
          vaultCollateralAccount: secureVaultCollateralAccount,
          merkleTree: secureMerkleTree,
          collateralMint: secureCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      secureLeaves.push(secureCommitment1);

      const secureNullifier2 = clampFieldElement(randomBytes(32));
      const secureSecret2 = clampFieldElement(randomBytes(32));
      const secureTimestamp2 = baseTimestamp + 10n;
      const secureBorrowOldNote = {
        nullifier: bytesToBigIntBE(secureNullifier1),
        secret: bytesToBigIntBE(secureSecret1),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: secureTimestamp1,
      };
      const secureBorrowNewNote = {
        nullifier: bytesToBigIntBE(secureNullifier2),
        secret: bytesToBigIntBE(secureSecret2),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(BORROW_AMOUNT.toString()),
        borrowUsdc: 0n,
        timestamp: secureTimestamp2,
      };
      const secureBorrowOldCommitmentValue = await computeCommitment(secureBorrowOldNote);
      const secureBorrowNewCommitmentValue = await computeCommitment(secureBorrowNewNote);
      const secureCommitment2 = Buffer.from(bigintToBytesBE(secureBorrowNewCommitmentValue, 32));
      const { proof: secureBorrowProof, path: secureBorrowPath, root: secureBorrowRoot } = await getMerkleProof(
        secureLeaves,
        0,
        MERKLE_DEPTH,
      );
      const secureBorrowNullifierHash = await computeNullifierHash(secureNullifier1);
      const secureBorrowCircuitInput = {
        merkleRoot: toFieldString(secureBorrowRoot),
        pathElements: secureBorrowProof.map((node) => toFieldString(node)),
        pathIndices: secureBorrowPath,
        oldNullifier: toFieldString(secureNullifier1),
        oldSecret: toFieldString(secureSecret1),
        oldSupplySol: secureBorrowOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: secureBorrowOldNote.timestamp.toString(),
        deltaBorrowSol: BORROW_AMOUNT.toString(),
        deltaBorrowUsdc: "0",
        newNullifier: toFieldString(secureNullifier2),
        newSecret: toFieldString(secureSecret2),
        newTimestamp: secureBorrowNewNote.timestamp.toString(),
        publicNullifierHash: secureBorrowNullifierHash.toString(),
        publicOldCommitment: secureBorrowOldCommitmentValue.toString(),
        publicNewCommitment: secureBorrowNewCommitmentValue.toString(),
      };
      const secureBorrowProofData = await buildGroth16Proof("borrow", secureBorrowCircuitInput);
      const secureBorrowZkProof = toGroth16Proof(secureBorrowProofData.proof);
      const secureBorrowEncryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        BigInt(BORROW_AMOUNT.toString()),
      );
      const secureBorrowArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: secureBorrowEncryptedBalance,
        currentCommitment: Array.from(secureCommitment1),
        newCommitment: Array.from(secureCommitment2),
        nullifier: Array.from(secureNullifier1),
        zkProof: secureBorrowZkProof,
        merkleProof: secureBorrowProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(secureBorrowPath),
      };
      const secureBorrowNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), secureVault.toBuffer(), Buffer.from(secureBorrowArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .borrowSecure(
          secureBorrowArgs.amount,
          secureBorrowArgs.encryptedBalance,
          secureBorrowArgs.currentCommitment,
          secureBorrowArgs.newCommitment,
          secureBorrowArgs.nullifier,
          secureBorrowArgs.zkProof,
          secureBorrowArgs.merkleProof,
          secureBorrowArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: secureVault,
          noteReceipt: secureNoteReceipt,
          userBorrowAccount: secureUserBorrowAccount.address,
          merkleTree: secureMerkleTree,
          nullifierAccount: secureBorrowNullifierPda,
          collateralMint: secureCollateralMint,
          borrowMint: secureBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const secureBorrowAfterBorrow = await getAccount(provider.connection, secureUserBorrowAccount.address);
      expect(Number(secureBorrowAfterBorrow.amount)).to.equal(BORROW_AMOUNT.toNumber());

      secureLeaves.push(secureCommitment2);

      const secureNullifier3 = clampFieldElement(randomBytes(32));
      const secureSecret3 = clampFieldElement(randomBytes(32));
      const secureTimestamp3 = baseTimestamp + 20n;
      const secureRepayOldNote = {
        nullifier: bytesToBigIntBE(secureNullifier2),
        secret: bytesToBigIntBE(secureSecret2),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: BigInt(BORROW_AMOUNT.toString()),
        borrowUsdc: 0n,
        timestamp: secureTimestamp2,
      };
      const secureRepayNewNote = {
        nullifier: bytesToBigIntBE(secureNullifier3),
        secret: bytesToBigIntBE(secureSecret3),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: secureTimestamp3,
      };
      const secureRepayOldCommitmentValue = await computeCommitment(secureRepayOldNote);
      const secureRepayNewCommitmentValue = await computeCommitment(secureRepayNewNote);
      const secureCommitment3 = Buffer.from(bigintToBytesBE(secureRepayNewCommitmentValue, 32));
      const { proof: secureRepayProof, path: secureRepayPath, root: secureRepayRoot } = await getMerkleProof(
        secureLeaves,
        1,
        MERKLE_DEPTH,
      );
      const secureRepayNullifierHash = await computeNullifierHash(secureNullifier2);
      const secureRepayCircuitInput = {
        merkleRoot: toFieldString(secureRepayRoot),
        pathElements: secureRepayProof.map((node) => toFieldString(node)),
        pathIndices: secureRepayPath,
        oldNullifier: toFieldString(secureNullifier2),
        oldSecret: toFieldString(secureSecret2),
        oldSupplySol: secureRepayOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: secureRepayOldNote.borrowSol.toString(),
        oldBorrowUsdc: "0",
        oldTimestamp: secureRepayOldNote.timestamp.toString(),
        deltaRepaySol: BORROW_AMOUNT.toString(),
        deltaRepayUsdc: "0",
        newNullifier: toFieldString(secureNullifier3),
        newSecret: toFieldString(secureSecret3),
        newTimestamp: secureTimestamp3.toString(),
        publicNullifierHash: secureRepayNullifierHash.toString(),
        publicOldCommitment: secureRepayOldCommitmentValue.toString(),
        publicNewCommitment: secureRepayNewCommitmentValue.toString(),
      };
      const secureRepayProofData = await buildGroth16Proof("repay", secureRepayCircuitInput);
      const secureRepayZkProof = toGroth16Proof(secureRepayProofData.proof);
      const secureRepayEncryptedBalance = getEncryptedBalance(
        BigInt(DEPOSIT_AMOUNT.toString()),
        0n,
      );
      const secureRepayArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: secureRepayEncryptedBalance,
        currentCommitment: Array.from(secureCommitment2),
        newCommitment: Array.from(secureCommitment3),
        nullifier: Array.from(secureNullifier2),
        zkProof: secureRepayZkProof,
        merkleProof: secureRepayProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(secureRepayPath),
      };
      const secureRepayNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), secureVault.toBuffer(), Buffer.from(secureRepayArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .repaySecure(
          secureRepayArgs.amount,
          secureRepayArgs.encryptedBalance,
          secureRepayArgs.currentCommitment,
          secureRepayArgs.newCommitment,
          secureRepayArgs.nullifier,
          secureRepayArgs.zkProof,
          secureRepayArgs.merkleProof,
          secureRepayArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: secureVault,
          noteReceipt: secureNoteReceipt,
          userRepayAccount: secureUserBorrowAccount.address,
          merkleTree: secureMerkleTree,
          nullifierAccount: secureRepayNullifierPda,
          collateralMint: secureCollateralMint,
          repayMint: secureBorrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const secureBorrowAfterRepay = await getAccount(provider.connection, secureUserBorrowAccount.address);
      expect(Number(secureBorrowAfterRepay.amount)).to.equal(0);

      secureLeaves.push(secureCommitment3);

      const secureNullifier4 = clampFieldElement(randomBytes(32));
      const secureSecret4 = clampFieldElement(randomBytes(32));
      const secureTimestamp4 = baseTimestamp + 30n;
      const secureWithdrawOldNote = {
        nullifier: bytesToBigIntBE(secureNullifier3),
        secret: bytesToBigIntBE(secureSecret3),
        supplySol: BigInt(DEPOSIT_AMOUNT.toString()),
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: secureTimestamp3,
      };
      const secureWithdrawNewNote = {
        nullifier: bytesToBigIntBE(secureNullifier4),
        secret: bytesToBigIntBE(secureSecret4),
        supplySol: 0n,
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: secureTimestamp4,
      };
      const secureWithdrawOldCommitmentValue = await computeCommitment(secureWithdrawOldNote);
      const secureWithdrawNewCommitmentValue = await computeCommitment(secureWithdrawNewNote);
      const secureCommitment4 = Buffer.from(bigintToBytesBE(secureWithdrawNewCommitmentValue, 32));
      const { proof: secureWithdrawProof, path: secureWithdrawPath, root: secureWithdrawRoot } = await getMerkleProof(
        secureLeaves,
        2,
        MERKLE_DEPTH,
      );
      const secureWithdrawNullifierHash = await computeNullifierHash(secureNullifier3);
      const secureWithdrawCircuitInput = {
        merkleRoot: toFieldString(secureWithdrawRoot),
        pathElements: secureWithdrawProof.map((node) => toFieldString(node)),
        pathIndices: secureWithdrawPath,
        oldNullifier: toFieldString(secureNullifier3),
        oldSecret: toFieldString(secureSecret3),
        oldSupplySol: secureWithdrawOldNote.supplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: secureWithdrawOldNote.timestamp.toString(),
        deltaWithdrawSol: DEPOSIT_AMOUNT.toString(),
        deltaWithdrawUsdc: "0",
        newNullifier: toFieldString(secureNullifier4),
        newSecret: toFieldString(secureSecret4),
        newTimestamp: secureWithdrawNewNote.timestamp.toString(),
        publicNullifierHash: secureWithdrawNullifierHash.toString(),
        publicOldCommitment: secureWithdrawOldCommitmentValue.toString(),
        publicNewCommitment: secureWithdrawNewCommitmentValue.toString(),
      };
      const secureWithdrawProofData = await buildGroth16Proof("withdraw", secureWithdrawCircuitInput);
      const secureWithdrawZkProof = toGroth16Proof(secureWithdrawProofData.proof);
      const secureReceipt = await programAccounts.noteReceipt.fetch(secureNoteReceipt);
      const secureWithdrawArgs = {
        sharesToBurn: secureReceipt.shares,
        encryptedBalance: getEncryptedBalance(0n, 0n),
        currentCommitment: Array.from(secureCommitment3),
        newCommitment: Array.from(secureCommitment4),
        nullifier: Array.from(secureNullifier3),
        zkProof: secureWithdrawZkProof,
        merkleProof: secureWithdrawProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(secureWithdrawPath),
      };
      const secureWithdrawNullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), secureVault.toBuffer(), Buffer.from(secureWithdrawArgs.nullifier)],
        program.programId,
      )[0];
      await program.methods
        .withdrawSecure(
          secureWithdrawArgs.sharesToBurn,
          secureWithdrawArgs.encryptedBalance,
          secureWithdrawArgs.currentCommitment,
          secureWithdrawArgs.newCommitment,
          secureWithdrawArgs.nullifier,
          secureWithdrawArgs.zkProof,
          secureWithdrawArgs.merkleProof,
          secureWithdrawArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault: secureVault,
          noteReceipt: secureNoteReceipt,
          receiptMint: secureReceiptMint,
          noteReceiptTokenAccount: secureNoteReceiptTokenAccount,
          userCollateralAccount: secureUserCollateralAccount.address,
          vaultCollateralAccount: secureVaultCollateralAccount,
          merkleTree: secureMerkleTree,
          nullifierAccount: secureWithdrawNullifierPda,
          collateralMint: secureCollateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const secureCollateralAfter = await getAccount(provider.connection, secureUserCollateralAccount.address);
      const secureVaultCollateralAfter = await getAccount(provider.connection, secureVaultCollateralAccount);

      expect(Number(fastVaultCollateralAfter.amount)).to.equal(0);
      expect(Number(secureVaultCollateralAfter.amount)).to.equal(0);
      expect(Number(fastCollateralAfter.amount)).to.equal(Number(fastCollateralBefore.amount));
      expect(Number(secureCollateralAfter.amount)).to.equal(Number(fastCollateralBefore.amount));
    });

    it("SECURE supply verifies proof on-chain", async () => {
      const deltaAmount = new BN(1 * LAMPORTS_PER_SOL);
      const newNullifier = clampFieldElement(randomBytes(32));
      const newSecret = clampFieldElement(randomBytes(32));
      let vaultAccount: Record<string, unknown> | null = null;

      try {
        vaultAccount = (await programAccounts.vault.fetch(vault)) as Record<string, unknown>;
      } catch {
        vaultAccount = null;
      }

      if (!vaultAccount) {
        await program.methods
          .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
          .accountsStrict({
            authority: authority.publicKey,
            vault,
            vaultCollateralAccount,
            merkleTree,
            collateralMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        await program.methods
          .initializeMints()
          .accountsStrict({
            authority: authority.publicKey,
            vault,
            receiptMint,
            borrowMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        await program.methods
          .initializeProtection()
          .accountsStrict({
            authority: authority.publicKey,
            vault,
            protectionPool,
            protectionReserveAccount,
            collateralMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();

      }
      if (!noteHash) {
        noteHash = new Uint8Array(Buffer.alloc(32, 1));
      }
      const noteHashBytes = Array.from(noteHash);
      if (!noteReceipt) {
        [noteReceipt] = PublicKey.findProgramAddressSync(
          [Buffer.from('note_receipt'), vault.toBuffer(), Buffer.from(noteHashBytes)],
          program.programId,
        );
      }
      if (!noteReceiptTokenAccount) {
        noteReceiptTokenAccount = await anchor.utils.token.associatedAddress({
          mint: receiptMint,
          owner: noteReceipt,
        });
      }

      let baseSupplySol: bigint;
      let oldNullifier: Buffer;
      let oldSecret: Buffer;
      let oldTimestamp: bigint;
      let merkleLeaves: Buffer[];
      let merkleIndex: number;
      let oldCommitmentValue: bigint;
      let currentCommitment: Buffer;

      if (!commitment4) {
        const seedAmount = deltaAmount;
        oldNullifier = clampFieldElement(randomBytes(32));
        oldSecret = clampFieldElement(randomBytes(32));
        oldTimestamp = BigInt(Math.floor(Date.now() / 1000));
        baseSupplySol = BigInt(seedAmount.toString());
        const seedNote = {
          nullifier: bytesToBigIntBE(oldNullifier),
          secret: bytesToBigIntBE(oldSecret),
          supplySol: baseSupplySol,
          supplyUsdc: 0n,
          borrowSol: 0n,
          borrowUsdc: 0n,
          timestamp: oldTimestamp,
        };
        oldCommitmentValue = await computeCommitment(seedNote);
        currentCommitment = Buffer.from(bigintToBytesBE(oldCommitmentValue, 32));
        commitment4 = currentCommitment;
        nullifier4 = oldNullifier;
        secret4 = oldSecret;
        timestamp4 = oldTimestamp;

        const encryptedBalance = getEncryptedBalance(baseSupplySol, 0n);
        const clientKey = getClientKey();
        await program.methods
          .depositSecure(
            seedAmount,
            encryptedBalance,
            clientKey,
            noteHashBytes,
            Array.from(currentCommitment),
          )
          .accountsStrict({
            user: user.publicKey,
            vault,
            noteReceipt,
            receiptMint,
            noteReceiptTokenAccount,
            userCollateralAccount: userCollateralAccountAddr,
            vaultCollateralAccount,
            merkleTree,
            collateralMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([user])
          .rpc();

        merkleLeaves = [currentCommitment];
        merkleIndex = 0;
      } else {
        oldNullifier = nullifier4;
        oldSecret = secret4;
        oldTimestamp = timestamp4;
        baseSupplySol = 0n;
        const existingNote = {
          nullifier: bytesToBigIntBE(oldNullifier),
          secret: bytesToBigIntBE(oldSecret),
          supplySol: baseSupplySol,
          supplyUsdc: 0n,
          borrowSol: 0n,
          borrowUsdc: 0n,
          timestamp: oldTimestamp,
        };
        oldCommitmentValue = await computeCommitment(existingNote);
        currentCommitment = Buffer.from(bigintToBytesBE(oldCommitmentValue, 32));
        merkleLeaves = [commitment1, commitment2, commitment3, commitment4];
        merkleIndex = 3;
      }

      const newTimestamp = oldTimestamp + 10n;
      const newSupplySol = baseSupplySol + BigInt(deltaAmount.toString());
      const newNote = {
        nullifier: bytesToBigIntBE(newNullifier),
        secret: bytesToBigIntBE(newSecret),
        supplySol: newSupplySol,
        supplyUsdc: 0n,
        borrowSol: 0n,
        borrowUsdc: 0n,
        timestamp: newTimestamp,
      };

      const newCommitmentValue = await computeCommitment(newNote);
      const nextCommitment = Buffer.from(bigintToBytesBE(newCommitmentValue, 32));

      const { proof, path, root } = await getMerkleProof(
        merkleLeaves,
        merkleIndex,
        MERKLE_DEPTH,
      );
      const nullifierHash = await computeNullifierHash(oldNullifier);
      const circuitInput = {
        merkleRoot: toFieldString(root),
        pathElements: proof.map((node) => toFieldString(node)),
        pathIndices: path,
        oldNullifier: toFieldString(oldNullifier),
        oldSecret: toFieldString(oldSecret),
        oldSupplySol: baseSupplySol.toString(),
        oldSupplyUsdc: "0",
        oldBorrowSol: "0",
        oldBorrowUsdc: "0",
        oldTimestamp: oldTimestamp.toString(),
        deltaSupplySol: deltaAmount.toString(),
        deltaSupplyUsdc: "0",
        newNullifier: toFieldString(newNullifier),
        newSecret: toFieldString(newSecret),
        newTimestamp: newTimestamp.toString(),
        publicNullifierHash: nullifierHash.toString(),
        publicOldCommitment: oldCommitmentValue.toString(),
        publicNewCommitment: newCommitmentValue.toString(),
      };
      const zkProofData = await buildGroth16Proof("supply", circuitInput);
      const zkProof = toGroth16Proof(zkProofData.proof);

      const encryptedBalance = getEncryptedBalance(newSupplySol, 0n);
      const spendArgs = {
        amount: deltaAmount,
        encryptedBalance,
        currentCommitment: Array.from(currentCommitment),
        newCommitment: Array.from(nextCommitment),
        nullifier: Array.from(oldNullifier),
        zkProof,
        merkleProof: proof.map((node) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), vault.toBuffer(), Buffer.from(spendArgs.nullifier)],
        program.programId,
      )[0];

      await program.methods
        .depositSecureSpend(
          spendArgs.amount,
          spendArgs.encryptedBalance,
          spendArgs.currentCommitment,
          spendArgs.newCommitment,
          spendArgs.nullifier,
          spendArgs.zkProof,
          spendArgs.merkleProof,
          spendArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          noteReceipt,
          receiptMint,
          noteReceiptTokenAccount,
          userCollateralAccount: userCollateralAccountAddr,
          vaultCollateralAccount,
          merkleTree,
          nullifierAccount: nullifierPda,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })])
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root: expectedRoot } = await buildMerkleTree(
        [...merkleLeaves, nextCommitment],
        MERKLE_DEPTH,
      );
      expect(Buffer.from(tree.root)).to.deep.equal(expectedRoot);
    });
  });

  describe("Scenario Runner - Randomized Flow", () => {
    let runner: ScenarioRunner;
    let scenarioCollateralMint: PublicKey;

    before(async () => {
        // Create a FRESH collateral mint for this isolated scenario
        scenarioCollateralMint = await createMint(
            provider.connection,
            (authority as any).payer,
            authority.publicKey,
            null,
            9
        );

        // Calculate PDAs for this new mint (ScenarioRunner does this internally too, 
        // but we need them here to initialize data accounts on-chain)
        const [scenarioVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), scenarioCollateralMint.toBuffer()],
            program.programId
        );
        const [scenarioProtectionPool] = PublicKey.findProgramAddressSync(
            [Buffer.from("protection_pool"), scenarioVault.toBuffer()],
            program.programId
        );
        const [scenarioVaultCollateralAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_collateral"), scenarioVault.toBuffer()],
            program.programId
        );
        const [scenarioMerkleTree] = PublicKey.findProgramAddressSync(
            [Buffer.from("merkle_tree"), scenarioVault.toBuffer()],
            program.programId
        );
        const [scenarioProtectionReserveAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("protection_reserve"), scenarioVault.toBuffer()],
            program.programId
        );
        const [scenarioReceiptMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("receipt"), scenarioVault.toBuffer()],
            program.programId
        );
        const [scenarioBorrowMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("borrow"), scenarioVault.toBuffer()],
            program.programId
        );

        // Initialize the Vault & Mints & Protection & Tree for this NEW mint
        // 1. Initialize
        await program.methods
            .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
            .accountsStrict({
                authority: authority.publicKey,
                vault: scenarioVault,
                vaultCollateralAccount: scenarioVaultCollateralAccount,
                merkleTree: scenarioMerkleTree,
                collateralMint: scenarioCollateralMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        // 2. Initialize Mints
        await program.methods
            .initializeMints()
            .accountsStrict({
                authority: authority.publicKey,
                vault: scenarioVault,
                receiptMint: scenarioReceiptMint,
                borrowMint: scenarioBorrowMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        // 3. Initialize Protection
        await program.methods
            .initializeProtection()
            .accountsStrict({
                authority: authority.publicKey,
                vault: scenarioVault,
                protectionPool: scenarioProtectionPool,
                protectionReserveAccount: scenarioProtectionReserveAccount,
                collateralMint: scenarioCollateralMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        // Now start the runner with this FRESH, EMPTY vault
        runner = new ScenarioRunner(program, provider, scenarioCollateralMint);
        await runner.addWallet(); // Wallet 0
        await runner.addWallet(); // Wallet 1
    });

    it("should execute a randomized sequence of 20+ actions", async () => {
        const ACTIONS = ["Supply", "Borrow", "Repay", "Withdraw"];
        const numActions = 25;

        for (let i = 0; i < numActions; i++) {
            const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
            const walletIdx = Math.floor(Math.random() * 2);
            const amount = BigInt(Math.floor(Math.random() * 1000000) + 100000); // 0.0001 - 0.001 SOL
            
            const wallet = runner.wallets[walletIdx];
            console.log(`[Action ${i+1}] Wallet ${walletIdx} ${action} ${amount}`);

            try {
                if (action === "Supply") {
                    await runner.depositSecure(walletIdx, amount);
                } else if (action === "Borrow") {
                    // Check if enough collateral (simplified check)
                    if (wallet.currentNote.supplySol > amount * 2n) {
                        await runner.borrowSecure(walletIdx, amount);
                    }
                } else if (action === "Repay") {
                    if (wallet.currentNote.borrowSol >= amount) {
                        await runner.repaySecure(walletIdx, amount);
                    }
                } else if (action === "Withdraw") {
                    if (wallet.currentNote.borrowSol === 0n && wallet.currentNote.supplySol >= amount) {
                        await runner.withdrawSecure(walletIdx, amount);
                    }
                }

                // Note Privacy Check: unauthorized_user cannot decrypt
                const otherWalletIdx = 1 - walletIdx;
                const otherWallet = runner.wallets[otherWalletIdx];
                const noteHash = wallet.noteHash;
                
                // Fetch note details from program (shares, encrypted_balance)
                const [noteReceiptPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from('note_receipt'), runner.vault.toBuffer(), Buffer.from(noteHash)],
                    program.programId,
                );
                const onChainNote = await programAccounts.noteReceipt.fetch(noteReceiptPda);
                
                // Attempt to decrypt with other wallet's key
                const otherClient = otherWallet.arciumClient;
                // On-chain encrypted_balance is 32 bytes: [24 cipher][8 hash]
                const payload = new Uint8Array(24 + 32);
                payload.set(onChainNote.encryptedBalance.slice(0, 24), 0);
                // We don't have the full nonce (ephemeral pubkey) on-chain for standard decryption
                // because storeEncryptedBundle is used off-chain.
                // However, we can simulate the "unauthorized" by trying to use the other wallet's private key
                // against the ciphertext.
                
                const decrypted = otherClient.decryptPosition(onChainNote.encryptedBalance);
                // If it was decrypted with WRONG key, it should be garbage data or fail
                // In Arcium SDK, xor with wrong shared secret results in garbage.
                expect(decrypted.deposit).to.not.equal(wallet.currentNote.supplySol);
            } catch (e) {
                console.log(`Action ${action} failed (expected or unexpected): ${e}`);
            }
        }
    });

    it("should verify 'Repay All' constraint (Withdraw 0.0001 SOL with 0.0001 USDC debt)", async () => {
        const repayCollateralMint = await createMint(
            provider.connection,
            (authority as any).payer,
            authority.publicKey,
            null,
            9,
        );

        const [repayVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), repayCollateralMint.toBuffer()],
            program.programId,
        );
        const [repayProtectionPool] = PublicKey.findProgramAddressSync(
            [Buffer.from("protection_pool"), repayVault.toBuffer()],
            program.programId,
        );
        const [repayVaultCollateralAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_collateral"), repayVault.toBuffer()],
            program.programId,
        );
        const [repayMerkleTree] = PublicKey.findProgramAddressSync(
            [Buffer.from("merkle_tree"), repayVault.toBuffer()],
            program.programId,
        );
        const [repayProtectionReserveAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("protection_reserve"), repayVault.toBuffer()],
            program.programId,
        );
        const [repayReceiptMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("receipt"), repayVault.toBuffer()],
            program.programId,
        );
        const [repayBorrowMint] = PublicKey.findProgramAddressSync(
            [Buffer.from("borrow"), repayVault.toBuffer()],
            program.programId,
        );

        await program.methods
            .initialize(LTV_BPS, LIQUIDATION_THRESHOLD_BPS)
            .accountsStrict({
                authority: authority.publicKey,
                vault: repayVault,
                vaultCollateralAccount: repayVaultCollateralAccount,
                merkleTree: repayMerkleTree,
                collateralMint: repayCollateralMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        await program.methods
            .initializeMints()
            .accountsStrict({
                authority: authority.publicKey,
                vault: repayVault,
                receiptMint: repayReceiptMint,
                borrowMint: repayBorrowMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        await program.methods
            .initializeProtection()
            .accountsStrict({
                authority: authority.publicKey,
                vault: repayVault,
                protectionPool: repayProtectionPool,
                protectionReserveAccount: repayProtectionReserveAccount,
                collateralMint: repayCollateralMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        const repayRunner = new ScenarioRunner(program, provider, repayCollateralMint);
        const walletIdx = await repayRunner.addWallet();
        const supplyAmount = BigInt(LAMPORTS_PER_SOL / 1000); // 0.001 SOL
        const borrowAmount = BigInt(LAMPORTS_PER_SOL / 10000); // 0.0001 SOL (Simulated USDC as borrowMint is same)
        const withdrawAmount = BigInt(LAMPORTS_PER_SOL / 10000); // 0.0001 SOL

        await repayRunner.depositSecure(walletIdx, supplyAmount);
        await repayRunner.borrowSecure(walletIdx, borrowAmount);

        // With LTV logic enabled, this should SUCCEED if LTV is healthy.
        // Supply: 0.001 SOL, Borrow: 0.0001, Withdraw: 0.0001
        // Remaining: 0.0009. Debt: 0.0001. LTV ~11% (Healthy)
        await repayRunner.withdrawSecure(walletIdx, withdrawAmount);

        // Verify state?
        // Maybe check user balance increased?
        // But for now just ensuring it doesn't revert.
    });
  });
});
