import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount
} from "@solana/spl-token";
import { expect } from "chai";
import { x25519 } from '@arcium-hq/client';
import { createHash, randomBytes } from 'crypto';
import BN from 'bn.js';


describe("VeilLend with Protection & Privacy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Veillend as Program<any>;
  const programAccounts = program.account as unknown as {
    vault: { fetch: (pubkey: PublicKey) => Promise<any> };
    protectionPool: { fetch: (pubkey: PublicKey) => Promise<any> };
    userReceipt: { fetch: (pubkey: PublicKey) => Promise<any> };
    merkleTree: { fetch: (pubkey: PublicKey) => Promise<any> };
    nullifier: { fetch: (pubkey: PublicKey) => Promise<any> };
  };
  
  const authority = provider.wallet;

  // Arcium Privacy Setup
  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  // Helper to get random encrypted balance (simulating encryption)
  const getEncryptedBalance = () => Array.from(randomBytes(32));
  const getClientKey = () => Array.from(clientPublicKey);

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
  // let userCollateralAccount: any;
  let userCollateralAccountAddr: PublicKey;
  let userBorrowAccountAddr: PublicKey;

  // Test user
  const user = Keypair.generate();

  // Constants
  const LTV_BPS = new BN(7500); // 75%
  const LIQUIDATION_THRESHOLD_BPS = new BN(8500); // 85%
  const DEPOSIT_AMOUNT = new BN(10 * LAMPORTS_PER_SOL);
  const BORROW_AMOUNT = new BN(5 * LAMPORTS_PER_SOL);
  const MERKLE_DEPTH = 8;
  let commitment1: Buffer;
  let commitment2: Buffer;
  let commitment3: Buffer;
  let commitment4: Buffer;
  let nullifier1: Buffer;
  let nullifier2: Buffer;
  let nullifier3: Buffer;

  const hashPair = (left: Buffer, right: Buffer) =>
    createHash('sha256').update(Buffer.concat([left, right])).digest();

  const computeZeroHashes = (depth: number) => {
    const hashes: Buffer[] = [Buffer.alloc(32)];
    for (let i = 0; i < depth; i += 1) {
      hashes.push(hashPair(hashes[i], hashes[i]));
    }
    return hashes;
  };

  const buildMerkleTree = (leaves: Buffer[], depth: number) => {
    const zeroHashes = computeZeroHashes(depth);
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
        next.push(hashPair(prev[i], prev[i + 1]));
      }
      layers.push(next);
    }
    return { layers, root: layers[depth][0] };
  };

  const getMerkleProof = (leaves: Buffer[], index: number, depth: number) => {
    const { layers, root } = buildMerkleTree(leaves, depth);
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



  // const REPAY_AMOUNT = new BN(2 * LAMPORTS_PER_SOL);
  // const WITHDRAW_AMOUNT = new BN(3 * LAMPORTS_PER_SOL);

  before(async () => {
    // Airdrop SOL to user for transaction fees
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      100 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

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

      await program.methods
        .initializeMerkleTree()
        .accountsStrict({
          authority: authority.publicKey,
          vault,
          merkleTree,
          systemProgram: SystemProgram.programId,
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
      
      const encryptedBalance = getEncryptedBalance();
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
      commitment1 = randomBytes(32);
      const encryptedBalance = getEncryptedBalance();
      const clientKey = getClientKey();

      await program.methods
        .depositSecure(DEPOSIT_AMOUNT, encryptedBalance, clientKey, Array.from(commitment1))
        .accountsStrict({
          user: user.publicKey,
          vault,
          userReceipt,
          receiptMint,
          userReceiptTokenAccount,
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
      const { root } = buildMerkleTree([commitment1], MERKLE_DEPTH);
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

      commitment2 = randomBytes(32);
      nullifier1 = randomBytes(32);
      const nullifier1Bytes = Array.from(nullifier1);

      const { proof, path } = getMerkleProof([commitment1], 0, MERKLE_DEPTH);
      const encryptedBalance = getEncryptedBalance();
      const borrowArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment1),
        newCommitment: Array.from(commitment2),
        nullifier: nullifier1Bytes,
        merkleProof: proof.map((node) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(nullifier1Bytes),
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
          borrowArgs.merkleProof,
          borrowArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          userReceipt,
          userBorrowAccount: userBorrowAccountAddr,
          kaminoMarket: PublicKey.default,
          kaminoObligation: PublicKey.default,
          kaminoLendingMarketAuthority: PublicKey.default,
          kaminoBorrowReserve: PublicKey.default,
          kaminoBorrowReserveLiquidityMint: PublicKey.default,
          kaminoReserveSourceLiquidity: PublicKey.default,
          kaminoBorrowReserveLiquidityFeeReceiver: PublicKey.default,
          kaminoReferrerTokenState: PublicKey.default,
          kaminoInstructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
          kaminoPythOracle: PublicKey.default,
          kaminoSwitchboardPriceOracle: PublicKey.default,
          kaminoSwitchboardTwapOracle: PublicKey.default,
          kaminoScopePrices: PublicKey.default,
          merkleTree,
          nullifierAccount: nullifierPda,
          collateralMint,
          borrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          kaminoProgram: PublicKey.default,
        })
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root } = buildMerkleTree([commitment1, commitment2], MERKLE_DEPTH);
      expect(Buffer.from(tree.root)).to.deep.equal(root);

    });

    it("should block double-spend with same nullifier", async () => {
      const { proof, path } = getMerkleProof([commitment1, commitment2], 1, MERKLE_DEPTH);
      const encryptedBalance = getEncryptedBalance();
      const nullifier1Bytes = Array.from(nullifier1);
      const borrowArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment2),
        newCommitment: Array.from(commitment2),
        nullifier: nullifier1Bytes,
        merkleProof: proof.map((node) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(nullifier1Bytes),
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
            borrowArgs.merkleProof,
            borrowArgs.merklePath,
          )
          .accountsStrict({
            user: user.publicKey,
            vault,
            userReceipt,
            userBorrowAccount: userBorrowAccountAddr,
            kaminoMarket: PublicKey.default,
            kaminoObligation: PublicKey.default,
            kaminoLendingMarketAuthority: PublicKey.default,
            kaminoBorrowReserve: PublicKey.default,
            kaminoBorrowReserveLiquidityMint: PublicKey.default,
            kaminoReserveSourceLiquidity: PublicKey.default,
            kaminoBorrowReserveLiquidityFeeReceiver: PublicKey.default,
            kaminoReferrerTokenState: PublicKey.default,
            kaminoInstructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
            kaminoPythOracle: PublicKey.default,
            kaminoSwitchboardPriceOracle: PublicKey.default,
            kaminoSwitchboardTwapOracle: PublicKey.default,
            kaminoScopePrices: PublicKey.default,
            merkleTree,
            nullifierAccount: nullifierPda,
            collateralMint,
            borrowMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            kaminoProgram: PublicKey.default,
          })
          .signers([user])
          .rpc();
        throw new Error('Expected double-spend to fail');
      } catch (error) {
        expect(String(error)).to.include('Nullifier already spent');
      }
    });

    it("should repay and withdraw with new commitments", async () => {
      commitment3 = randomBytes(32);
      nullifier2 = randomBytes(32);
      const nullifier2Bytes = Array.from(nullifier2);
      const { proof, path } = getMerkleProof([commitment1, commitment2], 1, MERKLE_DEPTH);
      const encryptedBalance = getEncryptedBalance();
      const repayArgs = {
        amount: BORROW_AMOUNT,
        encryptedBalance: encryptedBalance,
        currentCommitment: Array.from(commitment2),
        newCommitment: Array.from(commitment3),
        nullifier: nullifier2Bytes,
        merkleProof: proof.map((node) => Array.from(node)),
        merklePath: Buffer.from(path),
      };
      const nullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(nullifier2Bytes),
        ],
        program.programId,
      )[0];
      await program.methods
        .repaySecure(
          repayArgs.amount,
          repayArgs.encryptedBalance,
          repayArgs.currentCommitment,
          repayArgs.newCommitment,
          repayArgs.nullifier,
          repayArgs.merkleProof,
          repayArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          userReceipt,
          userRepayAccount: userBorrowAccountAddr,
          kaminoMarket: PublicKey.default,
          kaminoObligation: PublicKey.default,
          kaminoRepayReserve: PublicKey.default,
          kaminoReserveLiquidityMint: PublicKey.default,
          kaminoReserveDestinationLiquidity: PublicKey.default,
          kaminoInstructionSysvarAccount: SYSVAR_INSTRUCTIONS_PUBKEY,
          kaminoPythOracle: PublicKey.default,
          kaminoSwitchboardPriceOracle: PublicKey.default,
          kaminoSwitchboardTwapOracle: PublicKey.default,
          kaminoScopePrices: PublicKey.default,
          merkleTree,
          nullifierAccount: nullifierPda,
          collateralMint,
          repayMint: borrowMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          kaminoProgram: PublicKey.default,
        })
        .signers([user])
        .rpc();

      commitment4 = randomBytes(32);
      nullifier3 = randomBytes(32);
      const nullifier3Bytes = Array.from(nullifier3);
      const receipt = await programAccounts.userReceipt.fetch(userReceipt);
      const { proof: withdrawProof, path: withdrawPath } = getMerkleProof(
        [commitment1, commitment2, commitment3],
        2,
        MERKLE_DEPTH,
      );
      const withdrawArgs = {
        sharesToBurn: receipt.shares,
        encryptedBalance: getEncryptedBalance(),
        currentCommitment: Array.from(commitment3),
        newCommitment: Array.from(commitment4),
        nullifier: nullifier3Bytes,
        merkleProof: withdrawProof.map((node) => Array.from(node)),
        merklePath: Buffer.from(withdrawPath),
      };
      const withdrawNullifierPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from('nullifier'),
          vault.toBuffer(),
          Buffer.from(nullifier3Bytes),
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
          withdrawArgs.merkleProof,
          withdrawArgs.merklePath,
        )
        .accountsStrict({
          user: user.publicKey,
          vault,
          userReceipt,
          receiptMint,
          userReceiptTokenAccount,
          userCollateralAccount: userCollateralAccountAddr,
          vaultCollateralAccount,
          merkleTree,
          nullifierAccount: withdrawNullifierPda,
          collateralMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const tree = await programAccounts.merkleTree.fetch(merkleTree);
      const { root } = buildMerkleTree(
        [commitment1, commitment2, commitment3, commitment4],
        MERKLE_DEPTH,
      );
      expect(Buffer.from(tree.root)).to.deep.equal(root);
    });
  });
});
