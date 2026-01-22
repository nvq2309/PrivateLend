import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
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
  KAMINO_CONFIG,
  PROGRAM_ID_STRINGS,
  SOLANA_CLUSTER,
  USDC_MINT,
  WSOL_MINT,
} from '../config/solana';
import { isE2e } from '../config/e2e';
import {
  NoteRecord,
  clearNoteRecord,
  createInitialNoteRecord,
  loadNoteRecord,
  rotateNoteRecord,
  saveNoteRecord,
} from '../sdk/notes';
import { createFastAdapter } from '../sdk/adapter';
import {
  type ArciumKeypair,
  createArciumClient,
  encodeEncryptedBalance,
  initializeArciumKeypair,
  storeEncryptedBundle,
} from '../sdk/arcium';
import type { ArciumEncryptionClient } from '../sdk/veillend';
import {
  type PrivacyNoteV2,
  createPrivacyNote,
  getNextNoteIndex,
  getUnspentNotes,
  loadPrivacyNotes,
  loadSecrets,
  markNoteSpent,
  savePrivacyNote,
} from '../sdk/commitment';
import { fromHex, toHex } from '../sdk/commitment';
import { getMerkleProof } from '../sdk/merkle';
import {
  type SpendProof,
  generateSpendProof,
  isNullifierSpent,
  markNullifierSpent,
} from '../sdk/proof';

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

const depositSecureLayout = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'client_pubkey'),
  borsh.array(borsh.u8(), 32, 'commitment'),
]);

const secureSpendLayout = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'current_commitment'),
  borsh.array(borsh.u8(), 32, 'new_commitment'),
  borsh.array(borsh.u8(), 32, 'nullifier'),
  borsh.vec(borsh.array(borsh.u8(), 32), 'merkle_proof'),
  borsh.vec(borsh.u8(), 'merkle_path'),
]);

const withdrawSecureLayout = borsh.struct([
  borsh.u64('shares_to_burn'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'current_commitment'),
  borsh.array(borsh.u8(), 32, 'new_commitment'),
  borsh.array(borsh.u8(), 32, 'nullifier'),
  borsh.vec(borsh.array(borsh.u8(), 32), 'merkle_proof'),
  borsh.vec(borsh.u8(), 'merkle_path'),
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
    case 'deposit_secure': {
      const data = Buffer.alloc(depositSecureLayout.span);
      depositSecureLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'deposit_secure_spend': {
      const data = Buffer.alloc(secureSpendLayout.span + 1024);
      const encoded = secureSpendLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'borrow_secure': {
      const data = Buffer.alloc(secureSpendLayout.span + 1024);
      const encoded = secureSpendLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'repay_secure': {
      const data = Buffer.alloc(secureSpendLayout.span + 1024);
      const encoded = secureSpendLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'withdraw_secure': {
      const data = Buffer.alloc(withdrawSecureLayout.span + 1024);
      const encoded = withdrawSecureLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
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

const MERKLE_TREE_SEED = 'merkle_tree';
const MERKLE_TREE_DEPTH = 8;
const E2E_TEST_MODE = isE2e();

const merkleTreeLayout = borsh.struct([
  borsh.publicKey('vault'),
  borsh.u8('depth'),
  borsh.array(borsh.u8(), 32, 'root'),
  borsh.u32('next_index'),
  borsh.array(borsh.u8(), 32 * MERKLE_TREE_DEPTH, 'filled_subtrees'),
  borsh.u8('bump'),
  borsh.array(borsh.u8(), 32, 'reserved'),
]);

const toNumber = (value: BN | number | bigint | null | undefined) => {
  if (value === null || value === undefined) return 0;
  if (BN.isBN(value)) return value.toNumber();
  if (typeof value === 'bigint') return Number(value);
  return value;
};

const randomBytes32 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)));
const buildE2eSignature = () =>
  `e2e_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;

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

const deriveMerkleTreePda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(MERKLE_TREE_SEED), vault.toBuffer()], programId)[0];

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
  const e2eWalletAddress = E2E_TEST_MODE ? 'e2e-wallet' : null;
  const walletAddress = publicKey?.toBase58() ?? e2eWalletAddress;

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
  const merkleTreeAddress = useMemo(
    () => (programId && vaultAddress ? deriveMerkleTreePda(programId, vaultAddress) : null),
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
  const [merkleRoot, setMerkleRoot] = useState<Uint8Array | null>(null);
  const [merkleNextIndex, setMerkleNextIndex] = useState<number | null>(null);
  const [note, setNote] = useState<NoteRecord | null>(null);
  const [privacyNotes, setPrivacyNotes] = useState<PrivacyNoteV2[]>([]);
  const [lastSpendProof, setLastSpendProof] = useState<SpendProof | null>(null);
  const [arciumKeypair, setArciumKeypair] = useState<ArciumKeypair | null>(null);
  const [arciumClient, setArciumClient] = useState<ArciumEncryptionClient | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setArciumKeypair(null);
      setArciumClient(null);
      return;
    }
    const keypair = initializeArciumKeypair(publicKey.toBase58());
    setArciumKeypair(keypair);
    setArciumClient(createArciumClient(keypair));
  }, [publicKey]);

  const refreshNote = useCallback(() => {
    if (!walletAddress) {
      setNote(null);
      setPrivacyNotes([]);
      return;
    }
    setNote(loadNoteRecord(walletAddress));
    setPrivacyNotes(getUnspentNotes(walletAddress));
  }, [walletAddress]);

  const buildMerkleLeaves = useCallback((walletAddress: string, vaultAddress: string) => {
    const notes = loadPrivacyNotes(walletAddress).filter((note) => note.vaultAddress === vaultAddress);
    const maxIndex = notes.length ? Math.max(...notes.map((note) => note.noteIndex)) : -1;
    const leaves: Uint8Array[] = Array.from(
      { length: Math.max(0, maxIndex + 1) },
      () => new Uint8Array(32),
    );
    notes.forEach((note) => {
      leaves[note.noteIndex] = new Uint8Array(fromHex(note.commitment));
    });
    return leaves;
  }, []);

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

      if (merkleTreeAddress) {
        const treeInfo = await connection.getAccountInfo(merkleTreeAddress);
        if (treeInfo) {
          const tree = decodeAccount(merkleTreeLayout, treeInfo.data);
          setMerkleRoot(Uint8Array.from(tree.root));
          setMerkleNextIndex(Number(tree.next_index));
        } else {
          setMerkleRoot(null);
          setMerkleNextIndex(null);
        }
      } else {
        setMerkleRoot(null);
        setMerkleNextIndex(null);
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
    merkleTreeAddress,
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
    if (!walletAddress) {
      throw new Error('Wallet not connected');
    }
    const record = await createInitialNoteRecord(walletAddress);
    saveNoteRecord(record);
    setNote(record);
    return record;
  }, [walletAddress]);

  const rotateNote = useCallback(
    async (lastTxnId: string) => {
      if (!walletAddress) {
        throw new Error('Wallet not connected');
      }
      const record = await rotateNoteRecord(walletAddress, lastTxnId, note ?? undefined);
      saveNoteRecord(record);
      setNote(record);
      return record;
    },
    [note, walletAddress],
  );

  const clearNote = useCallback(() => {
    if (!walletAddress) return;
    clearNoteRecord(walletAddress);
    setNote(null);
  }, [walletAddress]);

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

  const getActivePrivacyNote = useCallback(
    (vaultKey: PublicKey) => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }
      const notes = getUnspentNotes(publicKey.toBase58(), vaultKey.toBase58());
      if (notes.length !== 1) {
        throw new Error('Exactly one active privacy note is required');
      }
      return notes[0];
    },
    [publicKey],
  );

  const buildMerkleProofForNote = useCallback(
    async (note: PrivacyNoteV2, vaultKey: PublicKey) => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }
      if (!merkleRoot) {
        throw new Error('Merkle tree not initialized');
      }
      const leaves = buildMerkleLeaves(publicKey.toBase58(), vaultKey.toBase58());
      const proof = await getMerkleProof(leaves, note.noteIndex, MERKLE_TREE_DEPTH);
      if (toHex(merkleRoot) !== toHex(proof.root)) {
        throw new Error('Merkle root mismatch for stored notes');
      }
      return proof;
    },
    [buildMerkleLeaves, merkleRoot, publicKey],
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

      const currentDeposit = myPosition?.deposit ?? 0;
      const currentBorrow = myPosition?.borrow ?? 0;
      const newDeposit = BigInt(currentDeposit) + BigInt(amount);
      const newBorrow = BigInt(currentBorrow);

      let encryptedBalance: number[];
      let clientPubkey: number[];

      if (arciumClient && arciumKeypair) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        clientPubkey = Array.from(arciumKeypair.publicKey);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
        clientPubkey = Array.from(publicKey.toBytes());
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
          encrypted_balance: encryptedBalance,
          client_pubkey: clientPubkey,
        }),
      });

      const signature = await sendTransaction([ix], preInstructions);

      if (vaultAddress) {
        const noteIndex = getNextNoteIndex(publicKey.toBase58());
        const privacyNote = await createPrivacyNote({
          walletAddress: publicKey.toBase58(),
          ownerPubkey: publicKey.toBytes(),
          vaultAddress: vaultAddress.toBase58(),
          depositAmount: BigInt(amount),
          borrowAmount: 0n,
          noteIndex,
        });
        savePrivacyNote(publicKey.toBase58(), privacyNote);
      }

      await refresh();
      return signature;
    },
    [
      arciumClient,
      arciumKeypair,
      buildAtaInstruction,
      connection,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
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

      const currentDeposit = myPosition?.deposit ?? 0;
      const currentBorrow = myPosition?.borrow ?? 0;
      const newDeposit = BigInt(Math.max(0, currentDeposit - amount));
      const newBorrow = BigInt(currentBorrow);

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('withdraw', {
          shares_to_burn: new BN(shareAmount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);

      const unspentNotes = getUnspentNotes(publicKey.toBase58(), vaultAddress.toBase58());
      const secrets = loadSecrets(publicKey.toBase58());
      if (unspentNotes.length > 0 && secrets) {
        const noteToSpend = unspentNotes[0];
        if (!isNullifierSpent(noteToSpend.nullifier)) {
          const spendProof = await generateSpendProof(noteToSpend, secrets, publicKey.toBase58());
          setLastSpendProof(spendProof);
          markNullifierSpent(noteToSpend.nullifier);
          markNoteSpent(publicKey.toBase58(), noteToSpend.nullifier, signature);
        }
      }

      await refresh();
      return signature;
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      myPosition,
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

      const kaminoBorrowConfig = {
        programId: KAMINO_CONFIG.programId,
        market: KAMINO_CONFIG.lendingMarket,
        obligation: KAMINO_CONFIG.obligation,
        lendingMarketAuthority: KAMINO_CONFIG.lendingMarketAuthority,
        borrowReserve: KAMINO_CONFIG.borrowReserve,
        borrowReserveLiquidityMint: KAMINO_CONFIG.borrowReserveLiquidityMint,
        reserveSourceLiquidity: KAMINO_CONFIG.reserveSourceLiquidity,
        borrowReserveLiquidityFeeReceiver: KAMINO_CONFIG.borrowReserveLiquidityFeeReceiver,
        referrerTokenState: KAMINO_CONFIG.referrerTokenState,
        pythOracle: KAMINO_CONFIG.pythOracle,
        switchboardPriceOracle: KAMINO_CONFIG.switchboardPriceOracle,
        switchboardTwapOracle: KAMINO_CONFIG.switchboardTwapOracle,
        scopePrices: KAMINO_CONFIG.scopePrices,
      };
      const hasKaminoBorrowConfig = Object.values(kaminoBorrowConfig).every(Boolean);
      if (kaminoBorrowConfig.programId && !hasKaminoBorrowConfig) {
        throw new Error('Kamino borrow config missing required accounts');
      }

      const kaminoMarket = kaminoBorrowConfig.market ?? PublicKey.default;
      const kaminoObligation = kaminoBorrowConfig.obligation ?? PublicKey.default;
      const kaminoProgram = hasKaminoBorrowConfig
        ? kaminoBorrowConfig.programId ?? PublicKey.default
        : PublicKey.default;
      const kaminoLendingMarketAuthority =
        kaminoBorrowConfig.lendingMarketAuthority ?? PublicKey.default;
      const kaminoBorrowReserve = kaminoBorrowConfig.borrowReserve ?? PublicKey.default;
      const kaminoBorrowReserveLiquidityMint =
        kaminoBorrowConfig.borrowReserveLiquidityMint ?? PublicKey.default;
      const kaminoReserveSourceLiquidity =
        kaminoBorrowConfig.reserveSourceLiquidity ?? PublicKey.default;
      const kaminoBorrowReserveLiquidityFeeReceiver =
        kaminoBorrowConfig.borrowReserveLiquidityFeeReceiver ?? PublicKey.default;
      const kaminoReferrerTokenState = kaminoBorrowConfig.referrerTokenState ?? PublicKey.default;
      const kaminoInstructionSysvarAccount = SYSVAR_INSTRUCTIONS_PUBKEY;
      const kaminoPythOracle = kaminoBorrowConfig.pythOracle ?? PublicKey.default;
      const kaminoSwitchboardPriceOracle =
        kaminoBorrowConfig.switchboardPriceOracle ?? PublicKey.default;
      const kaminoSwitchboardTwapOracle =
        kaminoBorrowConfig.switchboardTwapOracle ?? PublicKey.default;
      const kaminoScopePrices = kaminoBorrowConfig.scopePrices ?? PublicKey.default;

      const currentDeposit = myPosition?.deposit ?? 0;
      const currentBorrow = myPosition?.borrow ?? 0;
      const newDeposit = BigInt(currentDeposit);
      const newBorrow = BigInt(currentBorrow) + BigInt(amount);

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
      }

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userBorrowAta, isSigner: false, isWritable: true },
          { pubkey: kaminoMarket, isSigner: false, isWritable: false },
          { pubkey: kaminoObligation, isSigner: false, isWritable: false },
          { pubkey: kaminoLendingMarketAuthority, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserve, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserveLiquidityMint, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveSourceLiquidity, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserveLiquidityFeeReceiver, isSigner: false, isWritable: false },
          { pubkey: kaminoReferrerTokenState, isSigner: false, isWritable: false },
          { pubkey: kaminoInstructionSysvarAccount, isSigner: false, isWritable: false },
          { pubkey: kaminoPythOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardPriceOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardTwapOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoScopePrices, isSigner: false, isWritable: false },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: borrowMint, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: kaminoProgram, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('borrow', {
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      myPosition,
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

      const kaminoRepayConfig = {
        programId: KAMINO_CONFIG.programId,
        market: KAMINO_CONFIG.lendingMarket,
        obligation: KAMINO_CONFIG.obligation,
        repayReserve: KAMINO_CONFIG.repayReserve,
        reserveLiquidityMint: KAMINO_CONFIG.reserveLiquidityMint,
        reserveDestinationLiquidity: KAMINO_CONFIG.reserveDestinationLiquidity,
        pythOracle: KAMINO_CONFIG.pythOracle,
        switchboardPriceOracle: KAMINO_CONFIG.switchboardPriceOracle,
        switchboardTwapOracle: KAMINO_CONFIG.switchboardTwapOracle,
        scopePrices: KAMINO_CONFIG.scopePrices,
      };
      const hasKaminoRepayConfig = Object.values(kaminoRepayConfig).every(Boolean);
      if (kaminoRepayConfig.programId && !hasKaminoRepayConfig) {
        throw new Error('Kamino repay config missing required accounts');
      }

      const kaminoMarket = kaminoRepayConfig.market ?? PublicKey.default;
      const kaminoObligation = kaminoRepayConfig.obligation ?? PublicKey.default;
      const kaminoProgram = hasKaminoRepayConfig
        ? kaminoRepayConfig.programId ?? PublicKey.default
        : PublicKey.default;
      const kaminoRepayReserve = kaminoRepayConfig.repayReserve ?? PublicKey.default;
      const kaminoReserveLiquidityMint =
        kaminoRepayConfig.reserveLiquidityMint ?? PublicKey.default;
      const kaminoReserveDestinationLiquidity =
        kaminoRepayConfig.reserveDestinationLiquidity ?? PublicKey.default;
      const kaminoInstructionSysvarAccount = SYSVAR_INSTRUCTIONS_PUBKEY;
      const kaminoPythOracle = kaminoRepayConfig.pythOracle ?? PublicKey.default;
      const kaminoSwitchboardPriceOracle =
        kaminoRepayConfig.switchboardPriceOracle ?? PublicKey.default;
      const kaminoSwitchboardTwapOracle =
        kaminoRepayConfig.switchboardTwapOracle ?? PublicKey.default;
      const kaminoScopePrices = kaminoRepayConfig.scopePrices ?? PublicKey.default;

      const currentDeposit = myPosition?.deposit ?? 0;
      const currentBorrow = myPosition?.borrow ?? 0;
      const newDeposit = BigInt(currentDeposit);
      const newBorrow = BigInt(Math.max(0, currentBorrow - amount));

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
      }

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userRepayAta, isSigner: false, isWritable: true },
          { pubkey: kaminoMarket, isSigner: false, isWritable: false },
          { pubkey: kaminoObligation, isSigner: false, isWritable: false },
          { pubkey: kaminoRepayReserve, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveLiquidityMint, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveDestinationLiquidity, isSigner: false, isWritable: false },
          { pubkey: kaminoInstructionSysvarAccount, isSigner: false, isWritable: false },
          { pubkey: kaminoPythOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardPriceOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardTwapOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoScopePrices, isSigner: false, isWritable: false },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: repayMint, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: kaminoProgram, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('repay', {
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const secureDeposit = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!merkleTreeAddress || merkleNextIndex === null) {
        throw new Error('Merkle tree not initialized');
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

      const walletAddress = publicKey.toBase58();
      const existingNotes = getUnspentNotes(walletAddress, vaultAddress.toBase58());
      const hasExistingNote = existingNotes.length > 0;
      const activeNote = hasExistingNote ? getActivePrivacyNote(vaultAddress) : null;

      const baseDeposit = activeNote ? BigInt(activeNote.depositAmount) : 0n;
      const baseBorrow = activeNote ? BigInt(activeNote.borrowAmount) : 0n;
      const newDeposit = baseDeposit + BigInt(amount);
      const newBorrow = baseBorrow;

      let encryptedBalance: number[];
      let clientPubkey: number[];

      if (arciumClient && arciumKeypair) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        clientPubkey = Array.from(arciumKeypair.publicKey);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
        clientPubkey = Array.from(publicKey.toBytes());
      }

      const noteIndex = merkleNextIndex ?? getNextNoteIndex(walletAddress);
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey.toBytes(),
        vaultAddress: vaultAddress.toBase58(),
        depositAmount: newDeposit,
        borrowAmount: newBorrow,
        noteIndex,
      });
      const commitment = Array.from(fromHex(newNote.commitment));

      let ix: TransactionInstruction;
      if (hasExistingNote && activeNote) {
        const proof = await buildMerkleProofForNote(activeNote, vaultAddress);
        ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultAddress, isSigner: false, isWritable: true },
            { pubkey: userReceiptPda, isSigner: false, isWritable: true },
            { pubkey: receiptMint, isSigner: false, isWritable: true },
            { pubkey: userReceiptAta, isSigner: false, isWritable: true },
            { pubkey: userCollateralAta, isSigner: false, isWritable: true },
            { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
            { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
            { pubkey: PublicKey.findProgramAddressSync(
                [
                  Buffer.from('nullifier'),
                  vaultAddress.toBytes(),
                  fromHex(activeNote.nullifier),
                ],
                programId,
              )[0], isSigner: false, isWritable: true },
            { pubkey: collateral, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          ],
          data: encodeInstruction('deposit_secure_spend', {
            amount: new BN(amount),
            encrypted_balance: encryptedBalance,
            current_commitment: Array.from(fromHex(activeNote.commitment)),
            new_commitment: commitment,
            nullifier: Array.from(fromHex(activeNote.nullifier)),
            merkle_proof: proof.proof.map((node) => Array.from(node)),
            merkle_path: proof.path,
          }),
        });
      } else {
        ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultAddress, isSigner: false, isWritable: true },
            { pubkey: userReceiptPda, isSigner: false, isWritable: true },
            { pubkey: receiptMint, isSigner: false, isWritable: true },
            { pubkey: userReceiptAta, isSigner: false, isWritable: true },
            { pubkey: userCollateralAta, isSigner: false, isWritable: true },
            { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
            { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
            { pubkey: collateral, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          ],
          data: encodeInstruction('deposit_secure', {
            amount: new BN(amount),
            encrypted_balance: encryptedBalance,
            client_pubkey: clientPubkey,
            commitment,
          }),
        });
      }

      const signature = await sendTransaction([ix], preInstructions);
      if (hasExistingNote && activeNote) {
        markNoteSpent(walletAddress, activeNote.nullifier, signature);
      }
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      arciumKeypair,
      buildAtaInstruction,
      buildMerkleProofForNote,
      connection,
      getActivePrivacyNote,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const secureBorrow = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey || !borrowMintAddress) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!merkleTreeAddress || merkleNextIndex === null) {
        throw new Error('Merkle tree not initialized');
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

      const kaminoBorrowConfig = {
        programId: KAMINO_CONFIG.programId,
        market: KAMINO_CONFIG.lendingMarket,
        obligation: KAMINO_CONFIG.obligation,
        lendingMarketAuthority: KAMINO_CONFIG.lendingMarketAuthority,
        borrowReserve: KAMINO_CONFIG.borrowReserve,
        borrowReserveLiquidityMint: KAMINO_CONFIG.borrowReserveLiquidityMint,
        reserveSourceLiquidity: KAMINO_CONFIG.reserveSourceLiquidity,
        borrowReserveLiquidityFeeReceiver: KAMINO_CONFIG.borrowReserveLiquidityFeeReceiver,
        referrerTokenState: KAMINO_CONFIG.referrerTokenState,
        pythOracle: KAMINO_CONFIG.pythOracle,
        switchboardPriceOracle: KAMINO_CONFIG.switchboardPriceOracle,
        switchboardTwapOracle: KAMINO_CONFIG.switchboardTwapOracle,
        scopePrices: KAMINO_CONFIG.scopePrices,
      };
      const hasKaminoBorrowConfig = Object.values(kaminoBorrowConfig).every(Boolean);
      if (kaminoBorrowConfig.programId && !hasKaminoBorrowConfig) {
        throw new Error('Kamino borrow config missing required accounts');
      }

      const kaminoMarket = kaminoBorrowConfig.market ?? PublicKey.default;
      const kaminoObligation = kaminoBorrowConfig.obligation ?? PublicKey.default;
      const kaminoProgram = hasKaminoBorrowConfig
        ? kaminoBorrowConfig.programId ?? PublicKey.default
        : PublicKey.default;
      const kaminoLendingMarketAuthority =
        kaminoBorrowConfig.lendingMarketAuthority ?? PublicKey.default;
      const kaminoBorrowReserve = kaminoBorrowConfig.borrowReserve ?? PublicKey.default;
      const kaminoBorrowReserveLiquidityMint =
        kaminoBorrowConfig.borrowReserveLiquidityMint ?? PublicKey.default;
      const kaminoReserveSourceLiquidity =
        kaminoBorrowConfig.reserveSourceLiquidity ?? PublicKey.default;
      const kaminoBorrowReserveLiquidityFeeReceiver =
        kaminoBorrowConfig.borrowReserveLiquidityFeeReceiver ?? PublicKey.default;
      const kaminoReferrerTokenState = kaminoBorrowConfig.referrerTokenState ?? PublicKey.default;
      const kaminoInstructionSysvarAccount = SYSVAR_INSTRUCTIONS_PUBKEY;
      const kaminoPythOracle = kaminoBorrowConfig.pythOracle ?? PublicKey.default;
      const kaminoSwitchboardPriceOracle =
        kaminoBorrowConfig.switchboardPriceOracle ?? PublicKey.default;
      const kaminoSwitchboardTwapOracle =
        kaminoBorrowConfig.switchboardTwapOracle ?? PublicKey.default;
      const kaminoScopePrices = kaminoBorrowConfig.scopePrices ?? PublicKey.default;

      const activeNote = getActivePrivacyNote(vaultAddress);
      const proof = await buildMerkleProofForNote(activeNote, vaultAddress);
      const walletAddress = publicKey.toBase58();
      const newDeposit = BigInt(activeNote.depositAmount);
      const newBorrow = BigInt(activeNote.borrowAmount) + BigInt(amount);

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
      }

      const noteIndex = merkleNextIndex ?? getNextNoteIndex(walletAddress);
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey.toBytes(),
        vaultAddress: vaultAddress.toBase58(),
        depositAmount: newDeposit,
        borrowAmount: newBorrow,
        noteIndex,
      });

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userBorrowAta, isSigner: false, isWritable: true },
          { pubkey: kaminoMarket, isSigner: false, isWritable: false },
          { pubkey: kaminoObligation, isSigner: false, isWritable: false },
          { pubkey: kaminoLendingMarketAuthority, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserve, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserveLiquidityMint, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveSourceLiquidity, isSigner: false, isWritable: false },
          { pubkey: kaminoBorrowReserveLiquidityFeeReceiver, isSigner: false, isWritable: false },
          { pubkey: kaminoReferrerTokenState, isSigner: false, isWritable: false },
          { pubkey: kaminoInstructionSysvarAccount, isSigner: false, isWritable: false },
          { pubkey: kaminoPythOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardPriceOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardTwapOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoScopePrices, isSigner: false, isWritable: false },
          { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
            {
              pubkey: PublicKey.findProgramAddressSync(
                [
                  Buffer.from('nullifier'),
                  vaultAddress.toBytes(),
                  fromHex(activeNote.nullifier),
                ],
                programId,
              )[0],
              isSigner: false,
              isWritable: true,
            },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: borrowMint, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: kaminoProgram, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('borrow_secure', {
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
          current_commitment: Array.from(fromHex(activeNote.commitment)),
          new_commitment: Array.from(fromHex(newNote.commitment)),
          nullifier: Array.from(fromHex(activeNote.nullifier)),
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      borrowMintAddress,
      buildAtaInstruction,
      buildMerkleProofForNote,
      connection,
      getActivePrivacyNote,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
    ],
  );

  const secureRepay = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!merkleTreeAddress || merkleNextIndex === null) {
        throw new Error('Merkle tree not initialized');
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

      const kaminoRepayConfig = {
        programId: KAMINO_CONFIG.programId,
        market: KAMINO_CONFIG.lendingMarket,
        obligation: KAMINO_CONFIG.obligation,
        repayReserve: KAMINO_CONFIG.repayReserve,
        reserveLiquidityMint: KAMINO_CONFIG.reserveLiquidityMint,
        reserveDestinationLiquidity: KAMINO_CONFIG.reserveDestinationLiquidity,
        pythOracle: KAMINO_CONFIG.pythOracle,
        switchboardPriceOracle: KAMINO_CONFIG.switchboardPriceOracle,
        switchboardTwapOracle: KAMINO_CONFIG.switchboardTwapOracle,
        scopePrices: KAMINO_CONFIG.scopePrices,
      };
      const hasKaminoRepayConfig = Object.values(kaminoRepayConfig).every(Boolean);
      if (kaminoRepayConfig.programId && !hasKaminoRepayConfig) {
        throw new Error('Kamino repay config missing required accounts');
      }

      const kaminoMarket = kaminoRepayConfig.market ?? PublicKey.default;
      const kaminoObligation = kaminoRepayConfig.obligation ?? PublicKey.default;
      const kaminoProgram = hasKaminoRepayConfig
        ? kaminoRepayConfig.programId ?? PublicKey.default
        : PublicKey.default;
      const kaminoRepayReserve = kaminoRepayConfig.repayReserve ?? PublicKey.default;
      const kaminoReserveLiquidityMint =
        kaminoRepayConfig.reserveLiquidityMint ?? PublicKey.default;
      const kaminoReserveDestinationLiquidity =
        kaminoRepayConfig.reserveDestinationLiquidity ?? PublicKey.default;
      const kaminoInstructionSysvarAccount = SYSVAR_INSTRUCTIONS_PUBKEY;
      const kaminoPythOracle = kaminoRepayConfig.pythOracle ?? PublicKey.default;
      const kaminoSwitchboardPriceOracle =
        kaminoRepayConfig.switchboardPriceOracle ?? PublicKey.default;
      const kaminoSwitchboardTwapOracle =
        kaminoRepayConfig.switchboardTwapOracle ?? PublicKey.default;
      const kaminoScopePrices = kaminoRepayConfig.scopePrices ?? PublicKey.default;

      const activeNote = getActivePrivacyNote(vaultAddress);
      const proof = await buildMerkleProofForNote(activeNote, vaultAddress);
      const walletAddress = publicKey.toBase58();
      const newDeposit = BigInt(activeNote.depositAmount);
      const currentBorrow = BigInt(activeNote.borrowAmount);
      const repayAmount = BigInt(amount);
      const newBorrow = currentBorrow > repayAmount ? currentBorrow - repayAmount : 0n;

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
      }

      const noteIndex = merkleNextIndex ?? getNextNoteIndex(walletAddress);
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey.toBytes(),
        vaultAddress: vaultAddress.toBase58(),
        depositAmount: newDeposit,
        borrowAmount: newBorrow,
        noteIndex,
      });

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: userRepayAta, isSigner: false, isWritable: true },
          { pubkey: kaminoMarket, isSigner: false, isWritable: false },
          { pubkey: kaminoObligation, isSigner: false, isWritable: false },
          { pubkey: kaminoRepayReserve, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveLiquidityMint, isSigner: false, isWritable: false },
          { pubkey: kaminoReserveDestinationLiquidity, isSigner: false, isWritable: false },
          { pubkey: kaminoInstructionSysvarAccount, isSigner: false, isWritable: false },
          { pubkey: kaminoPythOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardPriceOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoSwitchboardTwapOracle, isSigner: false, isWritable: false },
          { pubkey: kaminoScopePrices, isSigner: false, isWritable: false },
          { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
            {
              pubkey: PublicKey.findProgramAddressSync(
                [
                  Buffer.from('nullifier'),
                  vaultAddress.toBytes(),
                  fromHex(activeNote.nullifier),
                ],
                programId,
              )[0],
              isSigner: false,
              isWritable: true,
            },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: repayMint, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: kaminoProgram, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('repay_secure', {
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
          current_commitment: Array.from(fromHex(activeNote.commitment)),
          new_commitment: Array.from(fromHex(newNote.commitment)),
          nullifier: Array.from(fromHex(activeNote.nullifier)),
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      buildAtaInstruction,
      buildMerkleProofForNote,
      connection,
      getActivePrivacyNote,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
    ],
  );

  const secureWithdraw = useCallback(
    async (shares: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!merkleTreeAddress || merkleNextIndex === null) {
        throw new Error('Merkle tree not initialized');
      }

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = decodeAccount(vaultLayout, vaultInfo.data);
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userReceiptAta, instructions } = await buildAtaInstruction(
        receiptMint,
        publicKey,
      );
      const { ata: userCollateralAta, instructions: collateralInstructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const preInstructions = [...instructions, ...collateralInstructions];

      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);
      const vaultCollateralPda = vaultCollateralAddress ?? deriveVaultCollateralPda(programId, vaultAddress);

      const activeNote = getActivePrivacyNote(vaultAddress);
      const proof = await buildMerkleProofForNote(activeNote, vaultAddress);
      const walletAddress = publicKey.toBase58();

      const totalShares = BigInt(vaultAccount.total_shares.toString());
      const totalCollateral = BigInt(vaultAccount.total_collateral.toString());
      const shareAmount = BigInt(shares);
      const collateralReturned = totalShares === 0n ? 0n : (shareAmount * totalCollateral) / totalShares;
      const newDeposit = BigInt(activeNote.depositAmount) - collateralReturned;
      if (newDeposit < 0n) {
        throw new Error('Withdrawal exceeds note balance');
      }
      const newBorrow = BigInt(activeNote.borrowAmount);

      let encryptedBalance: number[];
      if (arciumClient) {
        const bundle = arciumClient.encryptPosition(newDeposit, newBorrow);
        encryptedBalance = encodeEncryptedBalance(bundle);
        storeEncryptedBundle(publicKey.toBase58(), vaultAddress.toBase58(), bundle);
      } else {
        encryptedBalance = randomBytes32();
      }

      const noteIndex = merkleNextIndex ?? getNextNoteIndex(walletAddress);
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey.toBytes(),
        vaultAddress: vaultAddress.toBase58(),
        depositAmount: newDeposit,
        borrowAmount: newBorrow,
        noteIndex,
      });

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
          { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
            {
              pubkey: PublicKey.findProgramAddressSync(
                [
                  Buffer.from('nullifier'),
                  vaultAddress.toBytes(),
                  fromHex(activeNote.nullifier),
                ],
                programId,
              )[0],
              isSigner: false,
              isWritable: true,
            },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('withdraw_secure', {
          shares_to_burn: new BN(shares),
          encrypted_balance: encryptedBalance,
          current_commitment: Array.from(fromHex(activeNote.commitment)),
          new_commitment: Array.from(fromHex(newNote.commitment)),
          nullifier: Array.from(fromHex(activeNote.nullifier)),
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction([ix], preInstructions);
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return signature;
    },
    [
      arciumClient,
      buildAtaInstruction,
      buildMerkleProofForNote,
      connection,
      getActivePrivacyNote,
      merkleNextIndex,
      merkleTreeAddress,
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

  const e2eAction = useCallback(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    return buildE2eSignature();
  }, []);

  const fastAdapter = useMemo(
    () =>
      E2E_TEST_MODE
        ? createFastAdapter({
            deposit: e2eAction,
            withdraw: e2eAction,
            borrow: e2eAction,
            repay: e2eAction,
          })
        : createFastAdapter({
            deposit,
            withdraw,
            borrow,
            repay,
          }),
    [borrow, deposit, e2eAction, repay, withdraw],
  );

  const secureAdapter = useMemo(
    () =>
      E2E_TEST_MODE
        ? createFastAdapter({
            deposit: e2eAction,
            withdraw: e2eAction,
            borrow: e2eAction,
            repay: e2eAction,
          })
        : createFastAdapter({
            deposit: secureDeposit,
            withdraw: secureWithdraw,
            borrow: secureBorrow,
            repay: secureRepay,
          }),
    [e2eAction, secureBorrow, secureDeposit, secureRepay, secureWithdraw],
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
    privacyNotes,
    lastSpendProof,
    myPosition,
    vaultStats,
    protectionPoolStats,
    arciumClient,
    arciumKeypair,
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
    secureAdapter,
    isLoading,
    refresh,
  };
};
