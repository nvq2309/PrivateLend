import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

export async function airdrop(connection: Connection, pubkey: PublicKey, amount: number = 10) {
  const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
}

export async function createTestMint(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
  decimals: number = 9
): Promise<PublicKey> {
  return createMint(connection, payer, authority, null, decimals);
}

export async function mintTestTokens(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: number
) {
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, destination);
  await mintTo(connection, payer, mint, ata.address, authority, amount * LAMPORTS_PER_SOL);
  return ata;
}

export function derivePDAs(programId: PublicKey, collateralMint: PublicKey, user: PublicKey) {
  const [vault, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), collateralMint.toBuffer()],
    programId
  );

  const [protectionPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_pool"), vault.toBuffer()],
    programId
  );

  const [vaultCollateralAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_collateral"), vault.toBuffer()],
    programId
  );

  const [protectionReserveAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("protection_reserve"), vault.toBuffer()],
    programId
  );

  const [userReceipt] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_receipt"), vault.toBuffer(), user.toBuffer()],
    programId
  );

  return {
    vault,
    vaultBump,
    protectionPool,
    vaultCollateralAccount,
    protectionReserveAccount,
    userReceipt,
  };
}