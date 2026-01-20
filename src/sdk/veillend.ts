import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import { Veillend } from '../../target/types/veillend';

const VAULT_SEED = Buffer.from('vault');
const USER_RECEIPT_SEED = Buffer.from('user_receipt');
const VAULT_COLLATERAL_SEED = Buffer.from('vault_collateral');

type CiphertextBundle = {
  ciphertext: Uint8Array[];
  nonce: Uint8Array;
};

export interface ArciumEncryptionClient {
  encryptPosition(deposit: bigint, borrow: bigint): CiphertextBundle;
  decryptPosition(payload: Uint8Array): {
    deposit: bigint;
    borrow: bigint;
    shares: bigint;
  };
  getClientPublicKey(): Uint8Array;
}

export interface VeilLendSDKConfig {
  program: Program<Veillend>;
  arcium: ArciumEncryptionClient;
  kaminoProgramId: PublicKey;
  kaminoMarket: PublicKey;
  kaminoObligation: PublicKey;
  vaultRepayAccount: PublicKey;
}

export class VeilLendSDK {
  private readonly program: Program<Veillend>;
  private readonly arcium: ArciumEncryptionClient;
  private readonly kaminoProgramId: PublicKey;
  private readonly kaminoMarket: PublicKey;
  private readonly kaminoObligation: PublicKey;
  private readonly vaultRepayAccount: PublicKey;

  constructor(config: VeilLendSDKConfig) {
    this.program = config.program;
    this.arcium = config.arcium;
    this.kaminoProgramId = config.kaminoProgramId;
    this.kaminoMarket = config.kaminoMarket;
    this.kaminoObligation = config.kaminoObligation;
    this.vaultRepayAccount = config.vaultRepayAccount;
  }

  async deposit(
    wallet: anchor.Wallet,
    vaultAddress: PublicKey,
    amount: number,
  ): Promise<string> {
    const vaultAccount = await this.program.account.vault.fetch(vaultAddress);
    const receiptMint = vaultAccount.receiptMint as PublicKey;
    const collateralMint = vaultAccount.collateralMint as PublicKey;

    const [userReceiptPda] = this.deriveUserReceiptPda(vaultAddress, wallet.publicKey);
    const [vaultCollateralPda] = this.deriveVaultCollateralPda(vaultAddress);

    const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, wallet.publicKey);
    const userCollateralAta = getAssociatedTokenAddressSync(collateralMint, wallet.publicKey);

    const encryptedBalance = await this.encryptPositionWithDeltas(
      vaultAddress,
      wallet.publicKey,
      BigInt(amount),
      0n,
    );
    const clientPubkey = this.ensureLength(this.arcium.getClientPublicKey(), 32);

    const tx = await this.program.methods
      .deposit(new BN(amount), encryptedBalance, clientPubkey)
      .accounts({
        user: wallet.publicKey,
        vault: vaultAddress,
        userReceipt: userReceiptPda,
        receiptMint,
        userReceiptTokenAccount: userReceiptAta,
        userCollateralAccount: userCollateralAta,
        vaultCollateralAccount: vaultCollateralPda,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .transaction();

    return this.send(wallet, tx);
  }

  async withdraw(
    wallet: anchor.Wallet,
    vaultAddress: PublicKey,
    shares: number,
  ): Promise<string> {
    const vaultAccount = await this.program.account.vault.fetch(vaultAddress);
    const receiptMint = vaultAccount.receiptMint as PublicKey;
    const collateralMint = vaultAccount.collateralMint as PublicKey;

    const totalShares = BigInt(vaultAccount.totalShares.toString());
    const totalCollateral = BigInt(vaultAccount.totalCollateral.toString());
    if (totalShares === 0n) {
      throw new Error('Vault has no liquidity');
    }

    const shareAmount = BigInt(shares);
    const collateralReturned = shareAmount * totalCollateral / totalShares;

    const [userReceiptPda] = this.deriveUserReceiptPda(vaultAddress, wallet.publicKey);
    const [vaultCollateralPda] = this.deriveVaultCollateralPda(vaultAddress);
    const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, wallet.publicKey);
    const userCollateralAta = getAssociatedTokenAddressSync(collateralMint, wallet.publicKey);

    const encryptedBalance = await this.encryptPositionWithDeltas(
      vaultAddress,
      wallet.publicKey,
      -collateralReturned,
      0n,
    );

    const tx = await this.program.methods
      .withdraw(new BN(shares), encryptedBalance)
      .accounts({
        user: wallet.publicKey,
        vault: vaultAddress,
        userReceipt: userReceiptPda,
        receiptMint,
        userReceiptTokenAccount: userReceiptAta,
        userCollateralAccount: userCollateralAta,
        vaultCollateralAccount: vaultCollateralPda,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    return this.send(wallet, tx);
  }

  async borrow(
    wallet: anchor.Wallet,
    vaultAddress: PublicKey,
    amount: number,
  ): Promise<string> {
    const vaultAccount = await this.program.account.vault.fetch(vaultAddress);
    const borrowMint = vaultAccount.borrowMint as PublicKey;
    const collateralMint = vaultAccount.collateralMint as PublicKey;

    const [userReceiptPda] = this.deriveUserReceiptPda(vaultAddress, wallet.publicKey);
    const userBorrowAta = getAssociatedTokenAddressSync(borrowMint, wallet.publicKey);

    const encryptedBalance = await this.encryptPositionWithDeltas(
      vaultAddress,
      wallet.publicKey,
      0n,
      BigInt(amount),
    );

    const tx = await this.program.methods
      .borrow(new BN(amount), encryptedBalance)
      .accounts({
        user: wallet.publicKey,
        vault: vaultAddress,
        userReceipt: userReceiptPda,
        userBorrowAccount: userBorrowAta,
        kaminoMarket: this.kaminoMarket,
        kaminoObligation: this.kaminoObligation,
        collateralMint,
        borrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        kaminoProgram: this.kaminoProgramId,
      })
      .transaction();

    return this.send(wallet, tx);
  }

  async repay(
    wallet: anchor.Wallet,
    vaultAddress: PublicKey,
    amount: number,
  ): Promise<string> {
    const vaultAccount = await this.program.account.vault.fetch(vaultAddress);
    const borrowMint = vaultAccount.borrowMint as PublicKey;
    const collateralMint = vaultAccount.collateralMint as PublicKey;

    const [userReceiptPda] = this.deriveUserReceiptPda(vaultAddress, wallet.publicKey);
    const userState = await this.fetchUserReceipt(vaultAddress, wallet.publicKey);
    const userRepayAta = getAssociatedTokenAddressSync(borrowMint, wallet.publicKey);

    const repayAmount = userState.borrow < BigInt(amount) ? userState.borrow : BigInt(amount);
    if (repayAmount === 0n) {
      throw new Error('Nothing to repay');
    }

    const encryptedBalance = await this.encryptPositionWithDeltas(
      vaultAddress,
      wallet.publicKey,
      0n,
      -repayAmount,
    );

    const tx = await this.program.methods
      .repay(new BN(repayAmount.toString()), encryptedBalance)
      .accounts({
        user: wallet.publicKey,
        vault: vaultAddress,
        userReceipt: userReceiptPda,
        userRepayAccount: userRepayAta,
        vaultRepayAccount: this.vaultRepayAccount,
        collateralMint,
        repayMint: borrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();

    return this.send(wallet, tx);
  }

  async getMyPosition(
    userAddress: PublicKey,
    vaultAddress: PublicKey,
  ): Promise<{ deposit: bigint; borrow: bigint; shares: bigint }> {
    const [userReceiptPda] = this.deriveUserReceiptPda(vaultAddress, userAddress);
    const account = await this.program.account.userReceipt.fetch(userReceiptPda);

    const encryptedBalance = new Uint8Array(account.encryptedBalance as number[]);
    const plaintext = this.arcium.decryptPosition(encryptedBalance);

    return {
      deposit: plaintext.deposit,
      borrow: plaintext.borrow,
      shares: BigInt(account.shares.toString()),
    };
  }

  private deriveUserReceiptPda(vault: PublicKey, user: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [USER_RECEIPT_SEED, vault.toBuffer(), user.toBuffer()],
      this.program.programId,
    );
  }

  private deriveVaultCollateralPda(vault: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [VAULT_COLLATERAL_SEED, vault.toBuffer()],
      this.program.programId,
    );
  }

  private async fetchUserReceipt(
    vault: PublicKey,
    user: PublicKey,
  ): Promise<{ deposit: bigint; borrow: bigint; shares: bigint }> {
    const [userReceiptPda] = this.deriveUserReceiptPda(vault, user);
    try {
      const receipt = await this.program.account.userReceipt.fetch(userReceiptPda);
      return {
        deposit: BigInt(receipt.depositedCollateral.toString()),
        borrow: BigInt(receipt.borrowedAmount.toString()),
        shares: BigInt(receipt.shares.toString()),
      };
    } catch (error) {
      return { deposit: 0n, borrow: 0n, shares: 0n };
    }
  }

  private async encryptPositionWithDeltas(
    vault: PublicKey,
    user: PublicKey,
    deltaDeposit: bigint,
    deltaBorrow: bigint,
  ): Promise<number[]> {
    const current = await this.fetchUserReceipt(vault, user);
    const nextDeposit = current.deposit + deltaDeposit;
    const nextBorrow = current.borrow + deltaBorrow;

    if (nextDeposit < 0n || nextBorrow < 0n) {
      throw new Error('Resulting position would be negative');
    }

    const encrypted = this.arcium.encryptPosition(nextDeposit, nextBorrow);
    return this.ensureLength(encrypted.ciphertext[0], 32);
  }

  private ensureLength(data: Uint8Array, expected: number): number[] {
    if (data.length !== expected) {
      throw new Error(`Expected ${expected} bytes but received ${data.length}`);
    }
    return Array.from(data);
  }

  private async send(wallet: anchor.Wallet, tx: Transaction): Promise<string> {
    tx.feePayer = wallet.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.program.provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    const signed = await wallet.signTransaction(tx);
    const signature = await this.program.provider.connection.sendRawTransaction(signed.serialize());
    await this.program.provider.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });
    return signature;
  }
}
