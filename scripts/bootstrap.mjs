import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import anchorPkg from '@coral-xyz/anchor';

const anchor = anchorPkg;
const { BN } = anchorPkg;
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';

const CHAIN = process.env.CHAIN ?? 'localnet';
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.ANCHOR_PROVIDER_URL ??
  process.env.VITE_SOLANA_RPC_URL ??
  (CHAIN === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');

const DEMO_FAST_ONLY =
  process.argv.includes('--demo-fast-only') || process.env.DEMO_FAST_ONLY === 'true';

const DEFAULT_SOL_DEPOSIT = 0.01;
const SOL_DEPOSIT_OVERRIDE = process.env.DEPOSIT_SOL_AMOUNT ?? process.env.BOOTSTRAP_SOL_AMOUNT;
const SOL_DEPOSIT_AMOUNT = Number.parseFloat(SOL_DEPOSIT_OVERRIDE ?? String(DEFAULT_SOL_DEPOSIT));
const bootstrapUsdcEnv = process.env.BOOTSTRAP_USDC;
const SHOULD_BOOTSTRAP_USDC = bootstrapUsdcEnv ? bootstrapUsdcEnv === 'true' : true;
const bootstrapAirdropEnv = process.env.BOOTSTRAP_AIRDROP;
const SHOULD_AIRDROP = bootstrapAirdropEnv
  ? bootstrapAirdropEnv === 'true'
  : CHAIN !== 'devnet';

if (!Number.isFinite(SOL_DEPOSIT_AMOUNT) || SOL_DEPOSIT_AMOUNT <= 0) {
  throw new Error('Invalid SOL deposit amount. Set DEPOSIT_SOL_AMOUNT or BOOTSTRAP_SOL_AMOUNT.');
}

const DEPLOYER_KEYPAIR =
  process.env.DEPLOYER_KEYPAIR ?? process.env.ANCHOR_WALLET ?? '';
const PUBLIC_WALLET_KEYPAIR = process.env.PUBLIC_WALLET_KEYPAIR ?? '';
const PUBLIC_KEY = process.env.PUBLIC_KEY ?? '';

const resolveKeypairPath = (input) =>
  input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input;

const readKeypair = (keypairPath) => {
  if (!keypairPath) {
    throw new Error('Missing DEPLOYER_KEYPAIR (or ANCHOR_WALLET).');
  }
  const resolved = resolveKeypairPath(keypairPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
};

const loadIdl = () => {
  const idlPath = path.resolve('target/idl/veillend.json');
  const raw = fs.readFileSync(idlPath, 'utf8');
  return JSON.parse(raw);
};

const getProgramId = (idl) => {
  const envKey = CHAIN === 'devnet' ? 'VITE_PROGRAM_ID_DEVNET' : 'VITE_PROGRAM_ID_LOCALNET';
  const fromEnv = process.env[envKey];
  if (fromEnv) return new PublicKey(fromEnv);
  if (idl?.address) return new PublicKey(idl.address);
  throw new Error(`Missing program id: set ${envKey} in .env`);
};

const airdrop = async (connection, pubkey, sol) => {
  const signature = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
};

const maybeAirdrop = async (connection, pubkey, sol, label) => {
  try {
    const signature = await airdrop(connection, pubkey, sol);
    console.log(`[airdrop] ${label}: ${sol} SOL → ${pubkey.toBase58()} (${signature})`);
  } catch (error) {
    console.warn(`[airdrop] ${label} failed: ${String(error)}`);
  }
};

const ensureProgramDeployed = async (connection, programId) => {
  const info = await connection.getAccountInfo(programId);
  if (!info) {
    throw new Error(
      `Program ${programId.toBase58()} not found. Run \`anchor deploy\` first.`,
    );
  }
};

const run = async () => {
  const deployer = readKeypair(DEPLOYER_KEYPAIR);
  const publicWallet = PUBLIC_WALLET_KEYPAIR ? readKeypair(PUBLIC_WALLET_KEYPAIR) : null;
  const publicWalletPubkey = PUBLIC_KEY
    ? new PublicKey(PUBLIC_KEY)
    : publicWallet?.publicKey ?? deployer.publicKey;

  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(deployer),
    { commitment: 'confirmed' },
  );
  anchor.setProvider(provider);

  const idl = loadIdl();
  const programId = getProgramId(idl);
  idl.address = programId.toBase58();

  console.log(`[bootstrap] chain=${CHAIN} rpc=${RPC_URL}`);
  if (DEMO_FAST_ONLY) {
    console.log('[bootstrap] demo-fast-only enabled');
  }
  console.log(`[bootstrap] program=${programId.toBase58()}`);

  await ensureProgramDeployed(connection, programId);
  const program = new anchor.Program(idl, provider);

  if (SHOULD_AIRDROP) {
    await maybeAirdrop(connection, deployer.publicKey, 5, 'DEPLOYER');
    await maybeAirdrop(connection, publicWalletPubkey, 2, 'PUBLIC_WALLET');

    // Airdrop to E2E test wallets if configured
    const e2eWallet1Pubkey = process.env.E2E_WALLET_1_PUBLIC_KEY;
    const e2eWallet2Pubkey = process.env.E2E_WALLET_2_PUBLIC_KEY;
    if (e2eWallet1Pubkey) {
      try {
        const wallet1 = new PublicKey(e2eWallet1Pubkey);
        await maybeAirdrop(connection, wallet1, 10, 'E2E_WALLET_1');
      } catch (err) {
        console.warn('[airdrop] E2E_WALLET_1 invalid:', err);
      }
    }
    if (e2eWallet2Pubkey) {
      try {
        const wallet2 = new PublicKey(e2eWallet2Pubkey);
        await maybeAirdrop(connection, wallet2, 10, 'E2E_WALLET_2');
      } catch (err) {
        console.warn('[airdrop] E2E_WALLET_2 invalid:', err);
      }
    }
  } else {
    console.log('[airdrop] skipped (BOOTSTRAP_AIRDROP=false or devnet)');
  }

  const collateralMintAddress =
    process.env.VITE_COLLATERAL_MINT ?? 'So11111111111111111111111111111111111111112';
  const collateralMint = new PublicKey(collateralMintAddress);

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), collateralMint.toBuffer()],
    programId,
  );
  const [vaultCollateralAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_collateral'), vault.toBuffer()],
    programId,
  );
  const [protectionPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('protection_pool'), vault.toBuffer()],
    programId,
  );
  const [protectionReserveAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('protection_reserve'), vault.toBuffer()],
    programId,
  );
  const [receiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), vault.toBuffer()],
    programId,
  );
  const [borrowMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('borrow'), vault.toBuffer()],
    programId,
  );
  const [userReceipt] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_receipt'), vault.toBuffer(), deployer.publicKey.toBuffer()],
    programId,
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree'), vault.toBuffer()],
    programId,
  );

  const maybeInitialize = async (label, fn) => {
    try {
      await fn();
      console.log(`[init] ${label}: ok`);
    } catch (error) {
      const message = String(error);
      if (message.includes('already in use')) {
        console.log(`[init] ${label}: already initialized`);
        return;
      }
      throw error;
    }
  };

  await maybeInitialize('vault', async () => {
    await program.methods
      .initialize(new BN(7500), new BN(8500))
      .accountsStrict({
        authority: deployer.publicKey,
        vault,
        vaultCollateralAccount,
        merkleTree,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  await maybeInitialize('mints', async () => {
    await program.methods
      .initializeMints()
      .accountsStrict({
        authority: deployer.publicKey,
        vault,
        receiptMint,
        borrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  await maybeInitialize('protection', async () => {
    await program.methods
      .initializeProtection()
      .accountsStrict({
        authority: deployer.publicKey,
        vault,
        protectionPool,
        protectionReserveAccount,
        collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  const deployerCollateralAta = getAssociatedTokenAddressSync(
    collateralMint,
    deployer.publicKey,
  );
  const deployerAtaInfo = await connection.getAccountInfo(deployerCollateralAta);
  const setupInstructions = [];
  if (!deployerAtaInfo) {
    setupInstructions.push(
      createAssociatedTokenAccountInstruction(
        deployer.publicKey,
        deployerCollateralAta,
        deployer.publicKey,
        collateralMint,
      ),
    );
  }

  const depositAmount = Math.floor(SOL_DEPOSIT_AMOUNT * LAMPORTS_PER_SOL);
  setupInstructions.push(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: deployerCollateralAta,
      lamports: depositAmount,
    }),
  );
  setupInstructions.push(createSyncNativeInstruction(deployerCollateralAta));

  if (setupInstructions.length > 0) {
    const setupTx = new anchor.web3.Transaction().add(...setupInstructions);
    await provider.sendAndConfirm(setupTx, [deployer]);
  }

  const userReceiptTokenAccount = getAssociatedTokenAddressSync(
    receiptMint,
    deployer.publicKey,
  );

  const encryptedBalance = Array.from({ length: 32 }, () => 0);
  const clientPubkey = Array.from(deployer.publicKey.toBytes());

  const depositSignature = await program.methods
    .deposit(new BN(depositAmount), encryptedBalance, clientPubkey)
    .accountsStrict({
      user: deployer.publicKey,
      vault,
      userReceipt,
      receiptMint,
      userReceiptTokenAccount,
      userCollateralAccount: deployerCollateralAta,
      vaultCollateralAccount,
      collateralMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log(`[deposit] ${SOL_DEPOSIT_AMOUNT} SOL (tokenized) into vault: ${depositSignature}`);

  if (!SHOULD_BOOTSTRAP_USDC) {
    console.log('[bootstrap] Skipping USDC vault bootstrap (devnet default).');
    return;
  }

  const usdcMint = await createMint(
    connection,
    deployer,
    deployer.publicKey,
    null,
    6,
  );

  const [usdcVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), usdcMint.toBuffer()],
    programId,
  );
  const [usdcVaultCollateralAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_collateral'), usdcVault.toBuffer()],
    programId,
  );
  const [usdcProtectionPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('protection_pool'), usdcVault.toBuffer()],
    programId,
  );
  const [usdcProtectionReserveAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('protection_reserve'), usdcVault.toBuffer()],
    programId,
  );
  const [usdcReceiptMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('receipt'), usdcVault.toBuffer()],
    programId,
  );
  const [usdcBorrowMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('borrow'), usdcVault.toBuffer()],
    programId,
  );
  const [usdcUserReceipt] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_receipt'), usdcVault.toBuffer(), deployer.publicKey.toBuffer()],
    programId,
  );
  const [usdcMerkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree'), usdcVault.toBuffer()],
    programId,
  );

  await maybeInitialize('usdc-vault', async () => {
    await program.methods
      .initialize(new BN(8000), new BN(9000))
      .accountsStrict({
        authority: deployer.publicKey,
        vault: usdcVault,
        vaultCollateralAccount: usdcVaultCollateralAccount,
        merkleTree: usdcMerkleTree,
        collateralMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  await maybeInitialize('usdc-mints', async () => {
    await program.methods
      .initializeMints()
      .accountsStrict({
        authority: deployer.publicKey,
        vault: usdcVault,
        receiptMint: usdcReceiptMint,
        borrowMint: usdcBorrowMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  await maybeInitialize('usdc-protection', async () => {
    await program.methods
      .initializeProtection()
      .accountsStrict({
        authority: deployer.publicKey,
        vault: usdcVault,
        protectionPool: usdcProtectionPool,
        protectionReserveAccount: usdcProtectionReserveAccount,
        collateralMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  const deployerUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    deployer.publicKey,
  );
  const usdcAtaInfo = await connection.getAccountInfo(deployerUsdcAta);
  if (!usdcAtaInfo) {
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        deployer.publicKey,
        deployerUsdcAta,
        deployer.publicKey,
        usdcMint,
      ),
    );
    await provider.sendAndConfirm(createAtaTx, [deployer]);
  }

  const usdcDepositAmount = 10_000n * 1_000_000n;
  await mintTo(
    connection,
    deployer,
    usdcMint,
    deployerUsdcAta,
    deployer.publicKey,
    usdcDepositAmount,
  );

  const usdcUserReceiptTokenAccount = getAssociatedTokenAddressSync(
    usdcReceiptMint,
    deployer.publicKey,
  );

  const usdcDepositSignature = await program.methods
    .deposit(new BN(Number(usdcDepositAmount)), encryptedBalance, clientPubkey)
    .accountsStrict({
      user: deployer.publicKey,
      vault: usdcVault,
      userReceipt: usdcUserReceipt,
      receiptMint: usdcReceiptMint,
      userReceiptTokenAccount: usdcUserReceiptTokenAccount,
      userCollateralAccount: deployerUsdcAta,
      vaultCollateralAccount: usdcVaultCollateralAccount,
      collateralMint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log(`[deposit] 10,000 USDC into USDC vault: ${usdcDepositSignature}`);

  const vaultCollateralBalance = await getAccount(connection, vaultCollateralAccount);
  const usdcVaultBalance = await getAccount(connection, usdcVaultCollateralAccount);

  if (Number(vaultCollateralBalance.amount) < depositAmount) {
    throw new Error(
      `Vault collateral too low: expected at least ${depositAmount}, got ${vaultCollateralBalance.amount}`,
    );
  }
  if (Number(usdcVaultBalance.amount) < Number(usdcDepositAmount)) {
    throw new Error(
      `USDC Vault too low: expected at least ${usdcDepositAmount}, got ${usdcVaultBalance.amount}`,
    );
  }

  console.log('[verify] Vault balances OK');
  console.log(`- SOL Vault: ${vault.toBase58()}`);
  console.log(`- Collateral mint (wSOL): ${collateralMint.toBase58()}`);
  console.log(`- SOL Vault collateral: ${vaultCollateralBalance.amount} (${SOL_DEPOSIT_AMOUNT} SOL)`);
  console.log(`- USDC Vault: ${usdcVault.toBase58()}`);
  console.log(`- USDC mint: ${usdcMint.toBase58()}`);
  console.log(`- USDC Vault collateral: ${usdcVaultBalance.amount} (10,000 USDC)`);

  const envPath = path.resolve('.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const usdcMintLine = `VITE_USDC_MINT=${usdcMint.toBase58()}`;
  if (envContent.includes('VITE_USDC_MINT=')) {
    envContent = envContent.replace(/VITE_USDC_MINT=.*/g, usdcMintLine);
  } else {
    envContent = envContent.trimEnd() + '\n' + usdcMintLine + '\n';
  }
  fs.writeFileSync(envPath, envContent);
  console.log(`[env] Updated VITE_USDC_MINT in .env: ${usdcMint.toBase58()}`);
};

run().catch((error) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[bootstrap] failed:\n${message}`);
  process.exit(1);
});
