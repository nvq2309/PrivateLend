import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as borsh from '@coral-xyz/borsh';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Buffer } from 'buffer';

import idlJson from '../idl/veillend.json';
import {
  DEFAULT_COLLATERAL_MINT,
  PROGRAM_ID_STRINGS,
  SOLANA_CLUSTER,
  USDC_MINT,
  WSOL_MINT,
} from '../config/solana';
import {
  NoteRecord,
  clearNoteRecord,
  createInitialNoteRecord,
  loadNoteRecord,
  rotateNoteRecord,
  saveNoteRecord,
} from '../sdk/notes';
import { createFastAdapter } from '../sdk/adapter';

export interface Position {
  deposit: number;
  borrow: number;
  shares: number;
  healthFactor: number;
  protectionTier: number;
  protectionExpiry: number;
  lastUpdateTimestamp: number;
}

export interface VaultStats {
  totalCollateral: number;
  totalBorrowed: number;
  totalShares: number;
  ltv: number;
  liquidationThreshold: number;
}

export interface ProtectionPoolStats {
  reserveBalance: number;
  totalCoverage: number;
  totalSubscribers: number;
  totalExecutions: number;
  totalPremiumCollected: number;
  totalProtectionPaid: number;
}

const IDL_INSTRUCTIONS = (idlJson as any).instructions ?? [];
const getDiscriminator = (name: string) => {
  const ix = IDL_INSTRUCTIONS.find((entry: any) => entry.name === name);
  if (!ix || !Array.isArray(ix.discriminator) || ix.discriminator.length !== 8) {
    throw new Error(`Missing discriminator for ${name}`);
  }
  return Buffer.from(ix.discriminator);
};

const depositLayout = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'client_pubkey'),
]);

const withdrawLayout = borsh.struct([
  borsh.u64('shares_to_burn'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
]);

const borrowLayout = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
]);

const repayLayout = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
]);

const subscribeLayout = borsh.struct([
  borsh.u8('tier'),
  borsh.u16('duration_days'),
]);

const encodeInstruction = (name: string, args?: Record<string, any>) => {
  switch (name) {
    case 'deposit': {
      const data = Buffer.alloc(depositLayout.span);
      depositLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'withdraw': {
      const data = Buffer.alloc(withdrawLayout.span);
      withdrawLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'borrow': {
      const data = Buffer.alloc(borrowLayout.span);
      borrowLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'repay': {
      const data = Buffer.alloc(repayLayout.span);
      repayLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'subscribe_protection': {
      const data = Buffer.alloc(subscribeLayout.span);
      subscribeLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'execute_protection':
      return Buffer.from(getDiscriminator(name));
    default:
      throw new Error(`Unsupported instruction: ${name}`);
  }
};

const vaultLayout = borsh.struct([
  borsh.publicKey('authority'),
  borsh.publicKey('collateral_mint'),
  borsh.publicKey('receipt_mint'),
  borsh.publicKey('borrow_mint'),
  borsh.u64('total_collateral'),
  borsh.u64('total_borrowed'),
  borsh.u64('total_shares'),
  borsh.u64('ltv_bps'),
  borsh.u64('liquidation_threshold_bps'),
  borsh.bool('is_paused'),
  borsh.u8('bump'),
  borsh.array(borsh.u8(), 16, 'reserved'),
]);

const userReceiptLayout = borsh.struct([
  borsh.publicKey('owner'),
  borsh.publicKey('vault'),
  borsh.u64('shares'),
  borsh.u64('deposited_collateral'),
  borsh.u64('borrowed_amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'client_pubkey'),
  borsh.u8('protection_tier'),
  borsh.i64('protection_expiry'),
  borsh.i64('last_update_timestamp'),
  borsh.u8('bump'),
  borsh.array(borsh.u8(), 32, 'reserved'),
]);

const protectionPoolLayout = borsh.struct([
  borsh.publicKey('vault'),
  borsh.u64('reserve_balance'),
  borsh.u64('total_coverage'),
  borsh.u64('total_subscribers'),
  borsh.u64('total_executions'),
  borsh.u64('total_premium_collected'),
  borsh.u64('total_protection_paid'),
  borsh.u8('bump'),
  borsh.array(borsh.u8(), 16, 'reserve_padding'),
]);

const toNumber = (value: BN | number | bigint | null | undefined) => {
  if (value === null || value === undefined) return 0;
  if (BN.isBN(value)) return value.toNumber();
  if (typeof value === 'bigint') return Number(value);
  return value;
};

const randomBytes32 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)));

const deriveVaultPda = (programId: PublicKey, collateralMint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), collateralMint.toBuffer()],
    programId,
  )[0];

const deriveUserReceiptPda = (programId: PublicKey, vault: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('user_receipt'), vault.toBuffer(), owner.toBuffer()],
    programId,
  )[0];

const deriveVaultCollateralPda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('vault_collateral'), vault.toBuffer()],
    programId,
  )[0];

const deriveProtectionPoolPda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('protection_pool'), vault.toBuffer()],
    programId,
  )[0];

const deriveProtectionReservePda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('protection_reserve'), vault.toBuffer()],
    programId,
  )[0];

const decodeAccount = (layout: any, data: Buffer) => {
  if (data.length < 8 + layout.span) {
    throw new Error('Account data too short');
  }
  return layout.decode(data.subarray(8));
};

export const useVeilLend = (mint?: PublicKey) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  const collateralMint = mint ?? DEFAULT_COLLATERAL_MINT;
  const programIdBase58 = PROGRAM_ID_STRINGS[SOLANA_CLUSTER];
  const programId = useMemo(() => {
    if (!programIdBase58) return null;
    try {
      return new PublicKey(programIdBase58);
    } catch (error) {
      console.error('Invalid program id', error);
      return null;
    }
  }, [programIdBase58]);

  const [programError, setProgramError] = useState<string | null>(null);

  useEffect(() => {
    if (!programId) {
      setProgramError('Program not deployed for this cluster');
      return;
    }
    if (!Array.isArray(IDL_INSTRUCTIONS) || IDL_INSTRUCTIONS.length === 0) {
      setProgramError('Local IDL missing or invalid');
      return;
    }
    setProgramError(null);
  }, [programId]);

  const vaultAddress = useMemo(
    () => (programId ? deriveVaultPda(programId, collateralMint) : null),
    [collateralMint, programId],
  );
  const vaultCollateralAddress = useMemo(
    () => (programId && vaultAddress ? deriveVaultCollateralPda(programId, vaultAddress) : null),
    [programId, vaultAddress],
  );
  const protectionPoolAddress = useMemo(
    () => (programId && vaultAddress ? deriveProtectionPoolPda(programId, vaultAddress) : null),
    [programId, vaultAddress],
  );
  const protectionReserveAddress = useMemo(
    () => (programId && vaultAddress ? deriveProtectionReservePda(programId, vaultAddress) : null),
    [programId, vaultAddress],
  );
  const userReceiptAddress = useMemo(
    () =>
      programId && vaultAddress && publicKey
        ? deriveUserReceiptPda(programId, vaultAddress, publicKey)
        : null,
    [programId, publicKey, vaultAddress],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [myPosition, setMyPosition] = useState<Position | null>(null);
  const [vaultStats, setVaultStats] = useState<VaultStats | null>(null);
  const [protectionPoolStats, setProtectionPoolStats] = useState<ProtectionPoolStats | null>(null);
  const [walletBalanceLamports, setWalletBalanceLamports] = useState(0);
  const [collateralBalanceLamports, setCollateralBalanceLamports] = useState(0);
  const [borrowBalanceLamports, setBorrowBalanceLamports] = useState(0);
  const [usdcBalanceLamports, setUsdcBalanceLamports] = useState(0);
  const [collateralDecimals, setCollateralDecimals] = useState(9);
  const [borrowDecimals, setBorrowDecimals] = useState(6);
  const [borrowMintAddress, setBorrowMintAddress] = useState<PublicKey | null>(null);
  const [usdcVaultCollateralLamports, setUsdcVaultCollateralLamports] = useState(0);
  const [note, setNote] = useState<NoteRecord | null>(null);

  const refreshNote = useCallback(() => {
    if (!publicKey) {
      setNote(null);
      return;
    }
    setNote(loadNoteRecord(publicKey.toBase58()));
  }, [publicKey]);

  useEffect(() => {
    refreshNote();
  }, [refreshNote]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      if (publicKey) {
        const solBalance = await connection.getBalance(publicKey);
        setWalletBalanceLamports(solBalance);

        const ata = getAssociatedTokenAddressSync(
          collateralMint,
          publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const ataInfo = await connection.getAccountInfo(ata);
        if (ataInfo) {
          const balance = await connection.getTokenAccountBalance(ata);
          setCollateralBalanceLamports(Number(balance.value.amount));
          setCollateralDecimals(balance.value.decimals ?? 9);
        } else {
          setCollateralBalanceLamports(0);
          setCollateralDecimals(collateralMint.equals(WSOL_MINT) ? 9 : 6);
        }

        const usdcAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const usdcAtaInfo = await connection.getAccountInfo(usdcAta);
        if (usdcAtaInfo) {
          const usdcBalance = await connection.getTokenAccountBalance(usdcAta);
          setUsdcBalanceLamports(Number(usdcBalance.value.amount));
        } else {
          setUsdcBalanceLamports(0);
        }
      } else {
        setWalletBalanceLamports(0);
        setCollateralBalanceLamports(0);
        setBorrowBalanceLamports(0);
        setUsdcBalanceLamports(0);
      }

      if (!programId || !vaultAddress) {
        setVaultStats(null);
        setProtectionPoolStats(null);
        setMyPosition(null);
        return;
      }

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        setVaultStats(null);
        setMyPosition(null);
      } else {
        const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
        const liquidationThresholdBps = toNumber(vaultAccount.liquidation_threshold_bps);
        setBorrowMintAddress(vaultAccount.borrow_mint as PublicKey);
        setVaultStats({
          totalCollateral: toNumber(vaultAccount.total_collateral),
          totalBorrowed: toNumber(vaultAccount.total_borrowed),
          totalShares: toNumber(vaultAccount.total_shares),
          ltv: toNumber(vaultAccount.ltv_bps) / 100,
          liquidationThreshold: liquidationThresholdBps / 100,
        });

        if (userReceiptAddress && publicKey) {
          const receiptInfo = await connection.getAccountInfo(userReceiptAddress);
          if (receiptInfo) {
            const userReceipt = decodeAccount(userReceiptLayout, receiptInfo.data);
            const deposit = toNumber(userReceipt.deposited_collateral);
            const borrow = toNumber(userReceipt.borrowed_amount);
            const healthFactor =
              borrow > 0 ? Math.floor((deposit * liquidationThresholdBps) / borrow) : 0;
            setMyPosition({
              deposit,
              borrow,
              shares: toNumber(userReceipt.shares),
              healthFactor,
              protectionTier: userReceipt.protection_tier,
              protectionExpiry: Number(userReceipt.protection_expiry),
              lastUpdateTimestamp: Number(userReceipt.last_update_timestamp),
            });
          } else {
            setMyPosition(null);
          }
        } else {
          setMyPosition(null);
        }
      }

      if (programId) {
        const usdcVaultAddress = deriveVaultPda(programId, USDC_MINT);
        const usdcVaultInfo = await connection.getAccountInfo(usdcVaultAddress);
        if (usdcVaultInfo) {
          const usdcVaultAccount = decodeAccount(vaultLayout, usdcVaultInfo.data);
          setUsdcVaultCollateralLamports(toNumber(usdcVaultAccount.total_collateral));
        } else {
          setUsdcVaultCollateralLamports(0);
        }
      }

      if (protectionPoolAddress) {
        const poolInfo = await connection.getAccountInfo(protectionPoolAddress);
        if (poolInfo) {
          const pool = decodeAccount(protectionPoolLayout, poolInfo.data);
          setProtectionPoolStats({
            reserveBalance: toNumber(pool.reserve_balance),
            totalCoverage: toNumber(pool.total_coverage),
            totalSubscribers: toNumber(pool.total_subscribers),
            totalExecutions: toNumber(pool.total_executions),
            totalPremiumCollected: toNumber(pool.total_premium_collected),
            totalProtectionPaid: toNumber(pool.total_protection_paid),
          });
        } else {
          setProtectionPoolStats(null);
        }
      } else {
        setProtectionPoolStats(null);
      }

      if (publicKey && borrowMintAddress) {
        const borrowAta = getAssociatedTokenAddressSync(
          borrowMintAddress,
          publicKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const borrowAtaInfo = await connection.getAccountInfo(borrowAta);
        if (borrowAtaInfo) {
          const balance = await connection.getTokenAccountBalance(borrowAta);
          setBorrowBalanceLamports(Number(balance.value.amount));
          setBorrowDecimals(balance.value.decimals ?? 6);
        } else {
          setBorrowBalanceLamports(0);
          setBorrowDecimals(6);
        }
      } else {
        setBorrowBalanceLamports(0);
      }
    } catch (error) {
      console.warn('Failed to refresh VeilLend state:', error);
    } finally {
      setIsLoading(false);
    }
  }, [
    borrowMintAddress,
    collateralMint,
    connection,
    programId,
    protectionPoolAddress,
    publicKey,
    userReceiptAddress,
    vaultAddress,
  ]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refresh();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const createInitialNote = useCallback(async () => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    const record = await createInitialNoteRecord(publicKey.toBase58());
    saveNoteRecord(record);
    setNote(record);
    return record;
  }, [publicKey]);

  const rotateNote = useCallback(
    async (lastTxnId: string) => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }
      const record = await rotateNoteRecord(publicKey.toBase58(), lastTxnId, note ?? undefined);
      saveNoteRecord(record);
      setNote(record);
      return record;
    },
    [note, publicKey],
  );

  const clearNote = useCallback(() => {
    if (!publicKey) return;
    clearNoteRecord(publicKey.toBase58());
    setNote(null);
  }, [publicKey]);

  const buildAtaInstruction = useCallback(
    async (mintAddress: PublicKey, owner: PublicKey) => {
      const ata = getAssociatedTokenAddressSync(
        mintAddress,
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const info = await connection.getAccountInfo(ata);
      if (info) {
        return { ata, instructions: [] };
      }
      const ix = createAssociatedTokenAccountInstruction(
        owner,
        ata,
        owner,
        mintAddress,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      return { ata, instructions: [ix] };
    },
    [connection],
  );

  const sendTransaction = useCallback(
    async (instructions: TransactionInstruction[], preInstructions: TransactionInstruction[] = []) => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }
      if (!wallet.sendTransaction) {
        throw new Error('Wallet does not support transactions');
      }
      const tx = new Transaction().add(...preInstructions, ...instructions);
      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      return signature;
    },
    [connection, publicKey, wallet],
  );

  const deposit = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userCollateralAta, instructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const { ata: userReceiptAta, instructions: receiptInstructions } = await buildAtaInstruction(
        receiptMint,
        publicKey,
      );
      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);
      const vaultCollateralPda = vaultCollateralAddress ?? deriveVaultCollateralPda(programId, vaultAddress);
      const preInstructions = [...instructions, ...receiptInstructions];

      if (collateral.equals(WSOL_MINT)) {
        preInstructions.push(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: userCollateralAta,
            lamports: amount,
          }),
        );
        preInstructions.push(createSyncNativeInstruction(userCollateralAta));
      }

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: userReceiptAta, isSigner: false, isWritable: true },
          { pubkey: userCollateralAta, isSigner: false, isWritable: true },
          { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('deposit', {
          amount: new BN(amount),
          encrypted_balance: randomBytes32(),
          client_pubkey: Array.from(publicKey.toBytes()),
        }),
      });

      const signature = await sendTransaction([ix], preInstructions);
      await refresh();
      return signature;
    },
    [
      buildAtaInstruction,
      connection,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const withdraw = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!vaultStats || vaultStats.totalShares === 0 || vaultStats.totalCollateral === 0) {
        throw new Error('Vault has no liquidity');
      }
      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const shareAmount = Math.floor((amount * vaultStats.totalShares) / vaultStats.totalCollateral);

      const { ata: userCollateralAta, instructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, publicKey);
      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);
      const vaultCollateralPda = vaultCollateralAddress ?? deriveVaultCollateralPda(programId, vaultAddress);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: userReceiptAta, isSigner: false, isWritable: true },
          { pubkey: userCollateralAta, isSigner: false, isWritable: true },
          { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('withdraw', {
          shares_to_burn: new BN(shareAmount),
          encrypted_balance: randomBytes32(),
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return signature;
    },
    [
      buildAtaInstruction,
      connection,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
      vaultCollateralAddress,
      vaultStats,
    ],
  );

  const borrow = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
      const borrowMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userBorrowAta, instructions } = await buildAtaInstruction(
        borrowMint,
        publicKey,
      );
      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userBorrowAta, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: borrowMint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('borrow', {
          amount: new BN(amount),
          encrypted_balance: randomBytes32(),
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return signature;
    },
    [
      buildAtaInstruction,
      connection,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
    ],
  );

  const repay = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!vaultCollateralAddress) {
        throw new Error('Vault collateral account not derived');
      }
      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
      const repayMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userRepayAta, instructions } = await buildAtaInstruction(
        repayMint,
        publicKey,
      );
      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userRepayAta, isSigner: false, isWritable: true },
          { pubkey: vaultCollateralAddress, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: repayMint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('repay', {
          amount: new BN(amount),
          encrypted_balance: randomBytes32(),
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return signature;
    },
    [
      buildAtaInstruction,
      connection,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const subscribeProtection = useCallback(
    async (tier: number, duration: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!protectionPoolAddress || !protectionReserveAddress) {
        throw new Error('Protection pool not initialized');
      }

      const { ata: userPaymentAta, instructions } = await buildAtaInstruction(
        collateralMint,
        publicKey,
      );
      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: protectionPoolAddress, isSigner: false, isWritable: true },
          { pubkey: userPaymentAta, isSigner: false, isWritable: true },
          { pubkey: protectionReserveAddress, isSigner: false, isWritable: true },
          { pubkey: collateralMint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('subscribe_protection', {
          tier,
          duration_days: duration,
        }),
      });

      await sendTransaction([ix], instructions);
      await refresh();
    },
    [
      buildAtaInstruction,
      collateralMint,
      programId,
      protectionPoolAddress,
      protectionReserveAddress,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
    ],
  );

  const executeProtection = useCallback(async () => {
    if (!programId || !vaultAddress || !publicKey) {
      throw new Error('Program not ready or wallet not connected');
    }
    if (!protectionPoolAddress || !protectionReserveAddress || !vaultCollateralAddress) {
      throw new Error('Protection pool not initialized');
    }
    const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);

    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultAddress, isSigner: false, isWritable: true },
        { pubkey: publicKey, isSigner: false, isWritable: true },
        { pubkey: userReceiptPda, isSigner: false, isWritable: true },
        { pubkey: protectionPoolAddress, isSigner: false, isWritable: true },
        { pubkey: protectionReserveAddress, isSigner: false, isWritable: true },
        { pubkey: vaultCollateralAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeInstruction('execute_protection'),
    });

    await sendTransaction([ix]);
    await refresh();
  }, [
    collateralMint,
    programId,
    protectionPoolAddress,
    protectionReserveAddress,
    publicKey,
    refresh,
    sendTransaction,
    userReceiptAddress,
    vaultAddress,
    vaultCollateralAddress,
  ]);

  const borrowCapacityLamports = useMemo(() => {
    if (!myPosition || !vaultStats) return 0;
    const maxBorrow = Math.floor((myPosition.deposit * vaultStats.ltv) / 100);
    return Math.max(0, maxBorrow - myPosition.borrow);
  }, [myPosition, vaultStats]);

  const fastAdapter = useMemo(
    () =>
      createFastAdapter({
        deposit,
        withdraw,
        borrow,
        repay,
      }),
    [borrow, deposit, repay, withdraw],
  );

  return {
    program: null,
    programId,
    programError,
    cluster: SOLANA_CLUSTER,
    collateralMint,
    vaultAddress,
    userReceiptAddress,
    walletBalanceLamports,
    collateralBalanceLamports,
    borrowBalanceLamports,
    usdcBalanceLamports,
    usdcVaultCollateralLamports,
    collateralDecimals,
    borrowDecimals,
    borrowMintAddress,
    borrowCapacityLamports,
    note,
    myPosition,
    vaultStats,
    protectionPoolStats,
    deposit,
    withdraw,
    borrow,
    repay,
    subscribeProtection,
    executeProtection,
    createInitialNote,
    rotateNote,
    clearNote,
    refreshNote,
    fastAdapter,
    isLoading,
    refresh,
  };
};
