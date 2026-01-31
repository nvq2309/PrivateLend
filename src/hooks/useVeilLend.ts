import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
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
import { isE2e, shouldMockAdapters } from '../config/e2e';
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
  getTotalBalance,
  getUnspentNotes,
  loadPrivacyNotes,
  markNoteSpent,
  savePrivacyNote,
  savePrivacyNotes,
} from '../sdk/commitment';
import { fromHex, toHex } from '../sdk/commitment';
import { getMerkleProof } from '../sdk/merkle';
import { generateZkActionProof } from '../sdk/proof';
import { type ZkProofResult } from '../sdk/zkProof';
import { NOTE_STRING_PREFIX } from '../sdk/noteString';

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

const BORROW_LIMIT_BPS = 7000;
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

const depositNoteFastLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.vec(borsh.u8(), 'note_payload'),
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'client_pubkey'),
]);

const withdrawNoteFastLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.vec(borsh.u8(), 'note_payload'),
  borsh.u64('shares_to_burn'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
]);

const borrowNoteFastLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.vec(borsh.u8(), 'note_payload'),
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
]);

const repayNoteFastLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.vec(borsh.u8(), 'note_payload'),
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
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.array(borsh.u8(), 32, 'commitment'),
]);

const shieldPositionLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.array(borsh.u8(), 32, 'commitment'),
]);

const groth16ProofLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'aX'),
  borsh.array(borsh.u8(), 32, 'aY'),
  borsh.array(borsh.u8(), 32, 'bX0'),
  borsh.array(borsh.u8(), 32, 'bX1'),
  borsh.array(borsh.u8(), 32, 'bY0'),
  borsh.array(borsh.u8(), 32, 'bY1'),
  borsh.array(borsh.u8(), 32, 'cX'),
  borsh.array(borsh.u8(), 32, 'cY'),
], 'proof');

const secureSpendLayoutNoNoteHash = borsh.struct([
  borsh.u64('amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'current_commitment'),
  borsh.array(borsh.u8(), 32, 'new_commitment'),
  borsh.array(borsh.u8(), 32, 'nullifier'),
  groth16ProofLayout,
  borsh.vec(borsh.array(borsh.u8(), 32), 'merkle_proof'),
  borsh.vec(borsh.u8(), 'merkle_path'),
]);

const withdrawSecureLayout = borsh.struct([
  borsh.u64('shares_to_burn'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'current_commitment'),
  borsh.array(borsh.u8(), 32, 'new_commitment'),
  borsh.array(borsh.u8(), 32, 'nullifier'),
  groth16ProofLayout,
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
    case 'deposit_note_fast': {
      const data = Buffer.alloc(depositNoteFastLayout.span + 1024);
      const encoded = depositNoteFastLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'withdraw_note_fast': {
      const data = Buffer.alloc(withdrawNoteFastLayout.span + 1024);
      const encoded = withdrawNoteFastLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'borrow_note_fast': {
      const data = Buffer.alloc(borrowNoteFastLayout.span + 1024);
      const encoded = borrowNoteFastLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'repay_note_fast': {
      const data = Buffer.alloc(repayNoteFastLayout.span + 1024);
      const encoded = repayNoteFastLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
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
      const data = Buffer.alloc(secureSpendLayoutNoNoteHash.span + 1024);
      const encoded = secureSpendLayoutNoNoteHash.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'shield_position': {
      const data = Buffer.alloc(shieldPositionLayout.span);
      shieldPositionLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data]);
    }
    case 'borrow_secure': {
      const data = Buffer.alloc(secureSpendLayoutNoNoteHash.span + 1024);
      const encoded = secureSpendLayoutNoNoteHash.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'repay_secure': {
      const data = Buffer.alloc(secureSpendLayoutNoNoteHash.span + 1024);
      const encoded = secureSpendLayoutNoNoteHash.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'withdraw_secure': {
      const data = Buffer.alloc(withdrawSecureLayout.span + 1024);
      const encoded = withdrawSecureLayout.encode(args, data);
      return Buffer.concat([getDiscriminator(name), data.subarray(0, encoded)]);
    }
    case 'execute_protection':
      return Buffer.from(getDiscriminator(name));
    case 'initialize_merkle_tree':
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

const noteReceiptLayout = borsh.struct([
  borsh.array(borsh.u8(), 32, 'note_hash'),
  borsh.publicKey('vault'),
  borsh.u64('shares'),
  borsh.u64('deposited_collateral'),
  borsh.u64('borrowed_amount'),
  borsh.array(borsh.u8(), 32, 'encrypted_balance'),
  borsh.array(borsh.u8(), 32, 'client_pubkey'),
  borsh.i64('last_update_timestamp'),
  borsh.u8('bump'),
  borsh.array(borsh.u8(), 32, 'reserved'),
]);

const MERKLE_TREE_SEED = 'merkle_tree';
const MERKLE_TREE_DEPTH = 4;
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
const buildE2eProof = (signature: string): ZkProofResult => ({
  proof: {
    aX: Array(32).fill(0),
    aY: Array(32).fill(0),
    bX0: Array(32).fill(0),
    bX1: Array(32).fill(0),
    bY0: Array(32).fill(0),
    bY1: Array(32).fill(0),
    cX: Array(32).fill(0),
    cY: Array(32).fill(0),
  },
  publicSignals: [signature, 'e2e'],
});

const notePayloadFromString = (noteString: string) => {
  if (!noteString.startsWith(NOTE_STRING_PREFIX)) {
    throw new Error('Invalid note string format');
  }
  const encoded = noteString.slice(NOTE_STRING_PREFIX.length);
  if (encoded.length === 0) {
    throw new Error('Invalid note string payload');
  }
  const payload = Buffer.from(encoded, 'base64');
  if (!payload.length) {
    throw new Error('Invalid note string payload');
  }
  return new Uint8Array(payload);
};

const hashNotePayload = async (payload: Uint8Array) => {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto is unavailable for note hashing');
  }
  const data = payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
};

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

const deriveNoteReceiptPda = (programId: PublicKey, vault: PublicKey, noteHash: Uint8Array) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('note_receipt'), vault.toBuffer(), Buffer.from(noteHash)],
    programId,
  )[0];

const deriveVaultCollateralPda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('vault_collateral'), vault.toBuffer()],
    programId,
  )[0];

const deriveMerkleTreePda = (programId: PublicKey, vault: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from(MERKLE_TREE_SEED), vault.toBuffer()], programId)[0];

const safeDecodeAccount = (layout: any, data: Buffer) => {
  try {
    if (!data || data.length < 8 + layout.span) return null;
    return layout.decode(data.subarray(8));
  } catch {
    return null;
  }
};

export const useVeilLend = (mint?: PublicKey) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;
  const e2eWalletAddress = E2E_TEST_MODE ? 'e2e-wallet' : null;
  const e2eOverride =
    typeof window !== 'undefined'
      ? (window as Window & { __VEILLEND_E2E_WALLET_PUBLIC_KEY__?: string })
          .__VEILLEND_E2E_WALLET_PUBLIC_KEY__
      : null;
  const walletAddress = publicKey?.toBase58() ?? e2eOverride ?? e2eWalletAddress;

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
  const [vaultAuthority, setVaultAuthority] = useState<PublicKey | null>(null);
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
  const isMerkleTreeInitialized = E2E_TEST_MODE || merkleNextIndex !== null;
  const [note, setNote] = useState<NoteRecord | null>(null);
  const [privacyNotes, setPrivacyNotes] = useState<PrivacyNoteV2[]>([]);
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
    const storageKey = `veillend.note:${walletAddress}`;
    const record = loadNoteRecord(walletAddress);
    const pNotes = getUnspentNotes(walletAddress);
    console.warn('[strict][sdk] refreshNote', {
      walletPrefix: walletAddress.slice(0, 4) + '...',
      storageKey,
      noteCount: pNotes.length,
      hasNote: Boolean(record),
      noteHashPrefix: record?.noteHash ? record.noteHash.slice(0, 8) : null,
      noteStringPrefix: record?.noteString ? record.noteString.slice(0, 20) : null,
    });
    setNote(record);
    setPrivacyNotes(pNotes);
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
      if (E2E_TEST_MODE) {
        const e2eBalances =
          typeof window !== 'undefined'
            ? (window as Window & {
                __VEILLEND_E2E_BALANCES__?: {
                  walletBalanceLamports?: number;
                  collateralBalanceLamports?: number;
                  borrowBalanceLamports?: number;
                  usdcBalanceLamports?: number;
                };
              }).__VEILLEND_E2E_BALANCES__
            : null;
        const defaultDecimals = collateralMint.equals(WSOL_MINT) ? 9 : 6;
        setWalletBalanceLamports(
          e2eBalances?.walletBalanceLamports ?? 100 * Math.pow(10, 9),
        );
        setCollateralBalanceLamports(
          e2eBalances?.collateralBalanceLamports ?? 5 * Math.pow(10, defaultDecimals),
        );
        setBorrowBalanceLamports(e2eBalances?.borrowBalanceLamports ?? 0);
        setUsdcBalanceLamports(
          e2eBalances?.usdcBalanceLamports ?? 5 * Math.pow(10, 6),
        );
        setCollateralDecimals(defaultDecimals);
        setBorrowDecimals(6);
        setBorrowMintAddress(USDC_MINT);
        setVaultAuthority(publicKey ?? null);
        setVaultStats({
          totalCollateral: 0,
          totalBorrowed: 0,
          totalShares: 0,
          ltv: 75,
          liquidationThreshold: 85,
        });
        setMyPosition(null);
        console.debug('[strict][sdk] refresh (E2E)', {
          walletPrefix: e2eWalletAddress ? e2eWalletAddress.slice(0, 4) : null,
          walletBalanceLamports: e2eBalances?.walletBalanceLamports,
          merkleRootPrefix: 'mock'
        });
        setIsLoading(false);
        return;
      }
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
        setVaultAuthority(null);
        setMyPosition(null);
        return;
      }

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        setVaultStats(null);
        setVaultAuthority(null);
        setMyPosition(null);
      } else {
        const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
        if (!vaultAccount) {
          setVaultStats(null);
          setVaultAuthority(null);
          setMyPosition(null);
        } else {
          const liquidationThresholdBps = toNumber(vaultAccount.liquidation_threshold_bps);
          const ltvBps = Math.min(toNumber(vaultAccount.ltv_bps), BORROW_LIMIT_BPS);
          setVaultAuthority((prev) => {
            const newVal = vaultAccount.authority as PublicKey;
            return prev && prev.equals(newVal) ? prev : newVal;
          });
          setBorrowMintAddress((prev) => {
            const newVal = vaultAccount.borrow_mint as PublicKey;
            return prev && prev.equals(newVal) ? prev : newVal;
          });
          setVaultStats({
            totalCollateral: toNumber(vaultAccount.total_collateral),
            totalBorrowed: toNumber(vaultAccount.total_borrowed),
            totalShares: toNumber(vaultAccount.total_shares),
            ltv: ltvBps / 100,
            liquidationThreshold: liquidationThresholdBps / 100,
          });

          let nextPosition: Position | null = null;

          if (userReceiptAddress && publicKey) {
            const receiptInfo = await connection.getAccountInfo(userReceiptAddress);
            if (receiptInfo) {
              const userReceipt = safeDecodeAccount(userReceiptLayout, receiptInfo.data);
              if (userReceipt) {
                const deposit = toNumber(userReceipt.deposited_collateral);
                const borrow = toNumber(userReceipt.borrowed_amount);
                const healthFactor =
                  borrow > 0 ? Math.floor((deposit * liquidationThresholdBps) / borrow) : 0;

                nextPosition = {
                  deposit,
                  borrow,
                  shares: toNumber(userReceipt.shares),
                  healthFactor,
                  protectionTier: userReceipt.protection_tier,
                  protectionExpiry: Number(userReceipt.protection_expiry),
                  lastUpdateTimestamp: Number(userReceipt.last_update_timestamp),
                };
              }
            }
          }

          if (!nextPosition && note?.noteString) {
            try {
              const notePayload = notePayloadFromString(note.noteString);
              const noteHashBytes = await hashNotePayload(notePayload);
              const noteReceiptAddress = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
              const noteReceiptInfo = await connection.getAccountInfo(noteReceiptAddress);
              if (noteReceiptInfo) {
                const noteReceipt = safeDecodeAccount(noteReceiptLayout, noteReceiptInfo.data);
                if (noteReceipt) {
                  const deposit = toNumber(noteReceipt.deposited_collateral);
                  const borrow = toNumber(noteReceipt.borrowed_amount);
                  const healthFactor =
                    borrow > 0 ? Math.floor((deposit * liquidationThresholdBps) / borrow) : 0;

                  nextPosition = {
                    deposit,
                    borrow,
                    shares: toNumber(noteReceipt.shares),
                    healthFactor,
                    protectionTier: 0,
                    protectionExpiry: 0,
                    lastUpdateTimestamp: Number(noteReceipt.last_update_timestamp),
                  };
                }
              }
            } catch (error) {
              console.warn('[strict][sdk] note receipt refresh failed', error);
            }
          }

          setMyPosition(nextPosition);
          
          console.debug('[strict][sdk] refresh snapshot', {
            cluster: SOLANA_CLUSTER,
            vaultAddress: vaultAddress.toBase58(),
            walletPrefix: publicKey?.toBase58().slice(0, 4) + '...',
            walletBalanceLamports,
            collateralBalanceLamports,
            vaultStats: {
              totalCollateral: toNumber(vaultAccount.total_collateral),
              totalShares: toNumber(vaultAccount.total_shares)
            },
            merkleNextIndex
          });
        }
      }

      if (programId) {
        const usdcVaultAddress = deriveVaultPda(programId, USDC_MINT);
        const usdcVaultInfo = await connection.getAccountInfo(usdcVaultAddress);
        if (usdcVaultInfo) {
          const usdcVaultAccount = safeDecodeAccount(vaultLayout, usdcVaultInfo.data);
          if (usdcVaultAccount) {
            setUsdcVaultCollateralLamports(toNumber(usdcVaultAccount.total_collateral));
          } else {
            setUsdcVaultCollateralLamports(0);
          }
        } else {
          setUsdcVaultCollateralLamports(0);
        }
      }

      if (merkleTreeAddress) {
        const treeInfo = await connection.getAccountInfo(merkleTreeAddress);
        if (treeInfo) {
          const tree = safeDecodeAccount(merkleTreeLayout, treeInfo.data);
          if (tree) {
            setMerkleRoot(Uint8Array.from(tree.root));
            setMerkleNextIndex(Number(tree.next_index));
          } else {
            setMerkleRoot(null);
            setMerkleNextIndex(null);
          }
        } else if (E2E_TEST_MODE) {
          setMerkleRoot(new Uint8Array(32));
          setMerkleNextIndex(0);
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
          true,
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
    collateralBalanceLamports,
    connection,
    e2eWalletAddress,
    merkleNextIndex,
    note?.noteString,
    programId,
    publicKey,
    userReceiptAddress,
    vaultAddress,
    merkleTreeAddress,
    walletBalanceLamports,
  ]);

  const initialRefreshDone = useRef(false);
  useEffect(() => {
    if (!initialRefreshDone.current) {
      refresh();
      initialRefreshDone.current = true;
    }
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refresh();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  // Trigger immediate refresh when wallet connects/disconnects
  useEffect(() => {
    if (publicKey) {
      refresh();
    }
  }, [publicKey, refresh]);

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
    async (
      mintAddress: PublicKey,
      owner: PublicKey,
      payer: PublicKey = owner,
      allowOwnerOffCurve = false,
    ) => {
      const ata = getAssociatedTokenAddressSync(
        mintAddress,
        owner,
        allowOwnerOffCurve,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const info = await connection.getAccountInfo(ata);
      if (info) {
        return { ata, instructions: [] };
      }
      const ix = createAssociatedTokenAccountInstruction(
        payer,
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

  const resolveCollateralSymbol = useCallback(
    (mint: PublicKey) => (mint.equals(WSOL_MINT) ? 'SOL' : 'USDC') as 'SOL' | 'USDC',
    [],
  );

  const getNotePayloadBytes = useCallback(() => {
    if (!note?.noteString) {
      throw new Error('Note access key required');
    }
    return notePayloadFromString(note.noteString);
  }, [note]);

  const getNoteHashBytes = useCallback(async () => {
    if (note?.noteString) {
      const payload = notePayloadFromString(note.noteString);
      return await hashNotePayload(payload);
    }
    if (!note?.noteHash) {
      throw new Error('Note access key required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(note.noteHash)) {
      throw new Error('Invalid note access hash');
    }
    return fromHex(note.noteHash);
  }, [note]);

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
      console.debug('[strict][sdk] sendTransaction', {
        instructionCount: instructions.length,
        preInstructionCount: preInstructions.length,
        payer: publicKey.toBase58().slice(0, 8) + '...',
      });
      const tx = new Transaction().add(...preInstructions, ...instructions);
      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [...preInstructions, ...instructions],
      }).compileToV0Message();
      const simulation = await connection.simulateTransaction(new VersionedTransaction(message), {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (simulation.value.err) {
        const logSnippet = simulation.value.logs?.slice(-6).join(' | ');
        const details = logSnippet ? ` Logs: ${logSnippet}` : '';
        console.error('[strict][sdk] simulation failed', {
          error: simulation.value.err,
          logSnippet,
        });
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}.${details}`);
      }

      try {
        if (wallet.signTransaction) {
          const signed = await wallet.signTransaction(tx);
          const signature = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: true,
          });
          await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
          console.debug('[strict][sdk] transaction confirmed', { signature });
          return signature;
        }

        const signature = await wallet.sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        console.debug('[strict][sdk] transaction confirmed', { signature });
        return signature;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const logs = (error as { logs?: string[]; cause?: { logs?: string[] } })?.logs
          ?? (error as { cause?: { logs?: string[] } })?.cause?.logs;
        const logSnippet = logs?.slice(-6).join(' | ');
        const details = logSnippet ? ` Logs: ${logSnippet}` : '';
        console.error('[strict][sdk] sendTransaction error', { message, logSnippet });
        throw new Error(`${message}.${details}`);
      }
    },
    [connection, publicKey, wallet],
  );

  const shieldPosition = useCallback(
    async () => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!myPosition || (myPosition.shares === 0 && myPosition.deposit === 0 && myPosition.borrow === 0)) {
        throw new Error('No fast position available to shield');
      }
      if (!merkleTreeAddress) {
        throw new Error('Merkle tree address not derived');
      }

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
        throw new Error('Vault state invalid');
      }

      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;
      const collateralSymbol = resolveCollateralSymbol(collateral);
      const noteHashBytes = await getNoteHashBytes();

      const walletAddress = publicKey.toBase58();
      const noteIndex = merkleNextIndex ?? getNextNoteIndex(walletAddress);
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey.toBytes(),
        vaultAddress: vaultAddress.toBase58(),
        depositAmount: BigInt(myPosition.deposit),
        borrowAmount: BigInt(myPosition.borrow),
        noteIndex,
        collateralSymbol,
      });
      const commitment = Array.from(fromHex(newNote.commitment));

      if (merkleNextIndex === 0) {
        savePrivacyNotes(walletAddress, []);
      }

      const userReceiptPda = userReceiptAddress ?? deriveUserReceiptPda(programId, vaultAddress, publicKey);
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const { ata: userReceiptAta, instructions: userReceiptInstructions } = await buildAtaInstruction(
        receiptMint,
        publicKey,
        publicKey,
      );
      const { ata: noteReceiptAta, instructions: receiptInstructions } = await buildAtaInstruction(
        receiptMint,
        noteReceiptPda,
        publicKey,
        true,
      );
      const preInstructions = [...userReceiptInstructions, ...receiptInstructions];

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: userReceiptPda, isSigner: false, isWritable: true },
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: userReceiptAta, isSigner: false, isWritable: true },
          { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
          { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('shield_position', {
          note_hash: Array.from(noteHashBytes),
          commitment,
        }),
      });

      const signature = await sendTransaction([ix], preInstructions);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return { signature, note: newNote };
    },
    [
      buildAtaInstruction,
      connection,
      getNoteHashBytes,
      merkleNextIndex,
      merkleTreeAddress,
      myPosition,
      programId,
      publicKey,
      refresh,
      resolveCollateralSymbol,
      sendTransaction,
      userReceiptAddress,
      vaultAddress,
    ],
  );

  const resolveShieldedNote = useCallback(
    async (vaultKey: PublicKey, requireNote: boolean) => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }
      const walletAddress = publicKey.toBase58();
      const existingNotes = getUnspentNotes(walletAddress, vaultKey.toBase58());
      console.debug('[strict][sdk] resolveShieldedNote', {
        wallet: walletAddress.slice(0, 8) + '...',
        vault: vaultKey.toBase58(),
        requireNote,
        existingNotes: existingNotes.length,
      });

      const hasFastPosition = Boolean(
        myPosition && (myPosition.shares > 0 || myPosition.deposit > 0 || myPosition.borrow > 0),
      );

      if (existingNotes.length === 1) {
        try {
          const proof = await buildMerkleProofForNote(existingNotes[0], vaultKey);
          console.debug('[strict][sdk] resolveShieldedNote using existing note', {
            noteIndex: existingNotes[0].noteIndex,
          });
          return { note: existingNotes[0], proof };
        } catch (error) {
          if (hasFastPosition) {
            const shielded = await shieldPosition();
            const proof = await buildMerkleProofForNote(shielded.note, vaultKey);
            console.debug('[strict][sdk] resolveShieldedNote fallback shieldPosition', {
              noteIndex: shielded.note.noteIndex,
            });
            return { note: shielded.note, proof };
          }
          if (!requireNote) {
            return null;
          }
          throw error;
        }
      }

      if (existingNotes.length > 1) {
        throw new Error('Exactly one active privacy note is required');
      }

      if (!hasFastPosition) {
        if (requireNote) {
          throw new Error('No active privacy note for shielded actions');
        }
        return null;
      }

      const shielded = await shieldPosition();
      const proof = await buildMerkleProofForNote(shielded.note, vaultKey);
      console.debug('[strict][sdk] resolveShieldedNote shieldPosition', {
        noteIndex: shielded.note.noteIndex,
      });
      return { note: shielded.note, proof };
    },
    [buildMerkleProofForNote, myPosition, publicKey, shieldPosition],
  );

  const initializeMerkleTree = useCallback(async () => {
    if (!programId || !vaultAddress || !merkleTreeAddress || !publicKey) {
      throw new Error('Program not ready or wallet not connected');
    }
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultAddress, isSigner: false, isWritable: false },
        { pubkey: merkleTreeAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeInstruction('initialize_merkle_tree'),
    });

    await sendTransaction([ix]);
    await refresh();
  }, [merkleTreeAddress, programId, publicKey, refresh, sendTransaction, vaultAddress]);

  const deposit = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
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
      const clientPubkey = arciumKeypair
        ? Array.from(arciumKeypair.publicKey)
        : Array.from(publicKey.toBytes());

      if (arciumClient && arciumKeypair) {
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

      await refresh();
      return { signature };
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
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
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
      if (unspentNotes.length > 0) {
        const noteToSpend = unspentNotes[0];
        markNoteSpent(publicKey.toBase58(), noteToSpend.nullifier, signature);
      }

      await refresh();
      return { signature };
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
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
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
      return { signature };
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
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
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
      return { signature };
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

  const depositNoteFast = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const notePayload = getNotePayloadBytes();
      const noteHashBytes = await hashNotePayload(notePayload);

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
        throw new Error('Vault state invalid');
      }
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;
      const { ata: userCollateralAta, instructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const { ata: noteReceiptAta, instructions: receiptInstructions } = await buildAtaInstruction(
        receiptMint,
        noteReceiptPda,
        publicKey,
        true,
      );
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
      const clientPubkey = arciumKeypair
        ? Array.from(arciumKeypair.publicKey)
        : Array.from(publicKey.toBytes());

      if (arciumClient && arciumKeypair) {
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
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
          { pubkey: userCollateralAta, isSigner: false, isWritable: true },
          { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('deposit_note_fast', {
          note_hash: Array.from(noteHashBytes),
          note_payload: Array.from(notePayload),
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
          client_pubkey: clientPubkey,
        }),
      });

      const signature = await sendTransaction([ix], preInstructions);
      await refresh();
      return { signature };
    },
    [
      arciumClient,
      arciumKeypair,
      buildAtaInstruction,
      connection,
      getNotePayloadBytes,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const withdrawNoteFast = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!vaultStats || vaultStats.totalShares === 0 || vaultStats.totalCollateral === 0) {
        throw new Error('Vault has no liquidity');
      }
      const notePayload = getNotePayloadBytes();
      const noteHashBytes = await hashNotePayload(notePayload);

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
        throw new Error('Vault state invalid');
      }
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const shareAmount = Math.floor((amount * vaultStats.totalShares) / vaultStats.totalCollateral);

      const { ata: userCollateralAta, instructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const noteReceiptAta = getAssociatedTokenAddressSync(receiptMint, noteReceiptPda, true);
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
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
          { pubkey: userCollateralAta, isSigner: false, isWritable: true },
          { pubkey: vaultCollateralPda, isSigner: false, isWritable: true },
          { pubkey: collateral, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInstruction('withdraw_note_fast', {
          note_hash: Array.from(noteHashBytes),
          note_payload: Array.from(notePayload),
          shares_to_burn: new BN(shareAmount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return { signature };
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      getNotePayloadBytes,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      vaultAddress,
      vaultCollateralAddress,
      vaultStats,
    ],
  );

  const borrowNoteFast = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const notePayload = getNotePayloadBytes();
      const noteHashBytes = await hashNotePayload(notePayload);

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
        throw new Error('Vault state invalid');
      }
      const borrowMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userBorrowAta, instructions } = await buildAtaInstruction(
        borrowMint,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);

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
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
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
        data: encodeInstruction('borrow_note_fast', {
          note_hash: Array.from(noteHashBytes),
          note_payload: Array.from(notePayload),
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return { signature };
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      getNotePayloadBytes,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      vaultAddress,
    ],
  );

  const repayNoteFast = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      const notePayload = getNotePayloadBytes();
      const noteHashBytes = await hashNotePayload(notePayload);

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
        throw new Error('Vault state invalid');
      }
      const repayMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userRepayAta, instructions } = await buildAtaInstruction(
        repayMint,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);

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
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
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
        data: encodeInstruction('repay_note_fast', {
          note_hash: Array.from(noteHashBytes),
          note_payload: Array.from(notePayload),
          amount: new BN(amount),
          encrypted_balance: encryptedBalance,
        }),
      });

      const signature = await sendTransaction([ix], instructions);
      await refresh();
      return { signature };
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      getNotePayloadBytes,
      myPosition,
      programId,
      publicKey,
      refresh,
      sendTransaction,
      vaultAddress,
    ],
  );

  const secureDeposit = useCallback(
    async (amount: number) => {
      if (!programId || !vaultAddress || !publicKey) {
        throw new Error('Program not ready or wallet not connected');
      }
      if (!merkleTreeAddress) {
        throw new Error('Merkle tree address unavailable');
      }
      console.debug('[strict][sdk] secureDeposit start', {
        amount,
        vault: vaultAddress.toBase58(),
        merkleTree: merkleTreeAddress.toBase58(),
      });
      const noteHashBytes = await getNoteHashBytes();

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;
      const collateralSymbol = resolveCollateralSymbol(collateral);

      const { ata: userCollateralAta, instructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const { ata: noteReceiptAta, instructions: receiptInstructions } = await buildAtaInstruction(
        receiptMint,
        noteReceiptPda,
        publicKey,
      );
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
      const hasFastPosition = Boolean(
        myPosition && (myPosition.shares > 0 || myPosition.deposit > 0 || myPosition.borrow > 0),
      );
      const requireNote = existingNotes.length > 0 || hasFastPosition;
      const resolvedNote = await resolveShieldedNote(vaultAddress, requireNote);
      const activeNote = resolvedNote?.note ?? null;
      const proof = resolvedNote?.proof ?? null;
      console.debug('[strict][sdk] secureDeposit note resolution', {
        hasActiveNote: Boolean(activeNote),
        hasProof: Boolean(proof),
        requireNote,
      });

      const baseDeposit = activeNote ? BigInt(activeNote.depositAmount) : 0n;
      const baseBorrow = activeNote ? BigInt(activeNote.borrowAmount) : 0n;
      const newDeposit = baseDeposit + BigInt(amount);
      const newBorrow = baseBorrow;

      let encryptedBalance: number[];
      const clientPubkey = arciumKeypair
        ? Array.from(arciumKeypair.publicKey)
        : Array.from(publicKey.toBytes());

      if (arciumClient && arciumKeypair) {
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
        collateralSymbol,
      });
      const commitment = Array.from(fromHex(newNote.commitment));
      console.debug('[strict][sdk] secureDeposit new note', {
        noteIndex,
        commitmentPrefix: newNote.commitment.slice(0, 8),
      });

      let zkProofResult: ZkProofResult | null = null;

      let ix: TransactionInstruction;
      if (activeNote && proof) {
        zkProofResult = await generateZkActionProof({
          action: 'supply',
          oldNote: activeNote,
          newNote,
          merkleProof: proof,
          collateralSymbol,
          deltaAmount: BigInt(amount),
        });
        console.debug('[strict][sdk] secureDeposit using spend path', {
          hasProof: Boolean(zkProofResult),
          merklePathLength: proof.path.length,
        });
        ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultAddress, isSigner: false, isWritable: true },
            { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
            { pubkey: receiptMint, isSigner: false, isWritable: true },
            { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
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
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: encodeInstruction('deposit_secure_spend', {
            amount: new BN(amount),
            encrypted_balance: encryptedBalance,
            current_commitment: Array.from(fromHex(activeNote.commitment)),
            new_commitment: commitment,
            nullifier: Array.from(fromHex(activeNote.nullifier)),
            proof: zkProofResult.proof,
            merkle_proof: proof.proof.map((node) => Array.from(node)),
            merkle_path: proof.path,
          }),
        });
      } else {
        console.debug('[strict][sdk] secureDeposit using first-note path');
        ix = new TransactionInstruction({
          programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultAddress, isSigner: false, isWritable: true },
            { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
            { pubkey: receiptMint, isSigner: false, isWritable: true },
            { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
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
            note_hash: Array.from(noteHashBytes),
            commitment,
          }),
        });
      }

      const signature = await sendTransaction(
        [ix],
        activeNote
          ? [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...preInstructions]
          : preInstructions,
      );
      console.debug('[debug][sdk] secureDeposit submitted', { signature });
      if (activeNote) {
        markNoteSpent(walletAddress, activeNote.nullifier, signature);
      }
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return { signature, proof: zkProofResult ?? undefined };
    },
    [
      arciumClient,
      arciumKeypair,
      buildAtaInstruction,
      connection,
      merkleNextIndex,
      merkleTreeAddress,
      myPosition,
      programId,
      publicKey,
      refresh,
      resolveCollateralSymbol,
      resolveShieldedNote,
      sendTransaction,
      getNoteHashBytes,
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
      const noteHashBytes = await getNoteHashBytes();

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
      const borrowMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userBorrowAta, instructions } = await buildAtaInstruction(
        borrowMint,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const collateralSymbol = resolveCollateralSymbol(collateral);

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

      const resolvedNote = await resolveShieldedNote(vaultAddress, true);
      if (!resolvedNote) {
        throw new Error('No active privacy note for shielded actions');
      }
      const { note: activeNote, proof } = resolvedNote;
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
        collateralSymbol,
      });

      const zkProofResult = await generateZkActionProof({
        action: 'borrow',
        oldNote: activeNote,
        newNote,
        merkleProof: proof,
        collateralSymbol,
        deltaAmount: BigInt(amount),
      });
      const zkProof = zkProofResult.proof;

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
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
          proof: zkProof,
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction(
        [ix],
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...instructions],
      );
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return { signature, proof: zkProofResult };
    },
    [
      arciumClient,
      borrowMintAddress,
      buildAtaInstruction,
      connection,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      resolveCollateralSymbol,
      resolveShieldedNote,
      sendTransaction,
      getNoteHashBytes,
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
      const noteHashBytes = await getNoteHashBytes();

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
      const repayMint = vaultAccount.borrow_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const { ata: userRepayAta, instructions } = await buildAtaInstruction(
        repayMint,
        publicKey,
      );
      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const collateralSymbol = resolveCollateralSymbol(collateral);

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

      const resolvedNote = await resolveShieldedNote(vaultAddress, true);
      if (!resolvedNote) {
        throw new Error('No active privacy note for shielded actions');
      }
      const { note: activeNote, proof } = resolvedNote;
      const walletAddress = publicKey.toBase58();
      const newDeposit = BigInt(activeNote.depositAmount);
      const oldBorrow = BigInt(activeNote.borrowAmount);
      const requestedRepay = BigInt(amount);
      const deltaRepay = requestedRepay > oldBorrow ? oldBorrow : requestedRepay;
      const newBorrow = oldBorrow - deltaRepay;

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
        collateralSymbol,
      });

      const zkProofResult = await generateZkActionProof({
        action: 'repay',
        oldNote: activeNote,
        newNote,
        merkleProof: proof,
        collateralSymbol,
        deltaAmount: deltaRepay,
      });
      const zkProof = zkProofResult.proof;

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
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
          proof: zkProof,
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction(
        [ix],
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...instructions],
      );
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return { signature, proof: zkProofResult };
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      resolveCollateralSymbol,
      resolveShieldedNote,
      sendTransaction,
      getNoteHashBytes,
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
      const noteHashBytes = await getNoteHashBytes();

      const vaultInfo = await connection.getAccountInfo(vaultAddress);
      if (!vaultInfo) {
        throw new Error('Vault not initialized');
      }
      const vaultAccount = safeDecodeAccount(vaultLayout, vaultInfo.data);
      if (!vaultAccount) {
         throw new Error('Vault state invalid');
      }
      const receiptMint = vaultAccount.receipt_mint as PublicKey;
      const collateral = vaultAccount.collateral_mint as PublicKey;

      const noteReceiptPda = deriveNoteReceiptPda(programId, vaultAddress, noteHashBytes);
      const collateralSymbol = resolveCollateralSymbol(collateral);
      const { ata: noteReceiptAta, instructions } = await buildAtaInstruction(
        receiptMint,
        noteReceiptPda,
        publicKey,
      );
      const { ata: userCollateralAta, instructions: collateralInstructions } = await buildAtaInstruction(
        collateral,
        publicKey,
      );
      const preInstructions = [...instructions, ...collateralInstructions];

      const vaultCollateralPda = vaultCollateralAddress ?? deriveVaultCollateralPda(programId, vaultAddress);

      const resolvedNote = await resolveShieldedNote(vaultAddress, true);
      if (!resolvedNote) {
        throw new Error('No active privacy note for shielded actions');
      }
      const { note: activeNote, proof } = resolvedNote;
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
        collateralSymbol,
      });

      const zkProofResult = await generateZkActionProof({
        action: 'withdraw',
        oldNote: activeNote,
        newNote,
        merkleProof: proof,
        collateralSymbol,
        deltaAmount: collateralReturned,
      });
      const zkProof = zkProofResult.proof;

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultAddress, isSigner: false, isWritable: true },
          { pubkey: noteReceiptPda, isSigner: false, isWritable: true },
          { pubkey: receiptMint, isSigner: false, isWritable: true },
          { pubkey: noteReceiptAta, isSigner: false, isWritable: true },
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
          proof: zkProof,
          merkle_proof: proof.proof.map((node) => Array.from(node)),
          merkle_path: proof.path,
        }),
      });

      const signature = await sendTransaction(
        [ix],
        [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...preInstructions],
      );
      markNoteSpent(walletAddress, activeNote.nullifier, signature);
      savePrivacyNote(walletAddress, newNote);
      await refresh();
      return { signature, proof: zkProofResult };
    },
    [
      arciumClient,
      buildAtaInstruction,
      connection,
      merkleNextIndex,
      merkleTreeAddress,
      programId,
      publicKey,
      refresh,
      resolveCollateralSymbol,
      resolveShieldedNote,
      sendTransaction,
      getNoteHashBytes,
      vaultAddress,
      vaultCollateralAddress,
    ],
  );

  const privacyTotals = useMemo(() => {
    void privacyNotes;
    if (!walletAddress) return null;
    if (E2E_TEST_MODE) return getTotalBalance(walletAddress);
    if (!vaultAddress) return null;
    return getTotalBalance(walletAddress, vaultAddress.toBase58());
  }, [privacyNotes, vaultAddress, walletAddress]);

  const displayPosition = useMemo(() => {
    if (!privacyTotals || !vaultStats) return myPosition;
    const hasPrivateBalance = privacyTotals.deposit > 0n || privacyTotals.borrow > 0n;
    if (!hasPrivateBalance) return myPosition;

    const deposit = Number(privacyTotals.deposit);
    const borrow = Number(privacyTotals.borrow);
    const liquidationThresholdBps = Math.round(vaultStats.liquidationThreshold * 100);
    const healthFactor = borrow > 0
      ? Math.floor((deposit * liquidationThresholdBps) / borrow)
      : 0;

    return {
      deposit,
      borrow,
      shares: myPosition?.shares ?? 0,
      healthFactor,
      protectionTier: myPosition?.protectionTier ?? 0,
      protectionExpiry: myPosition?.protectionExpiry ?? 0,
      lastUpdateTimestamp: myPosition?.lastUpdateTimestamp ?? 0,
    };
  }, [myPosition, privacyTotals, vaultStats]);

  const borrowCapacityLamports = useMemo(() => {
    if (!displayPosition || !vaultStats) return 0;
    const maxBorrow = Math.floor((displayPosition.deposit * vaultStats.ltv) / 100);
    return Math.max(0, maxBorrow - displayPosition.borrow);
  }, [displayPosition, vaultStats]);

  const e2eFastAction = useCallback(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    return { signature: buildE2eSignature() };
  }, []);

  const e2eSecureAction = useCallback(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const signature = buildE2eSignature();
    return { signature, proof: buildE2eProof(signature) };
  }, []);


  const fastAdapter = useMemo(
    () =>
      shouldMockAdapters()
        ? createFastAdapter({
            deposit: e2eFastAction,
            withdraw: e2eFastAction,
            borrow: e2eFastAction,
            repay: e2eFastAction,
          })
        : createFastAdapter({
            deposit,
            withdraw,
            borrow,
            repay,
          }),
    [borrow, deposit, e2eFastAction, repay, withdraw],
  );

  const noteFastAdapter = useMemo(
    () =>
      shouldMockAdapters()
        ? createFastAdapter({
            deposit: e2eFastAction,
            withdraw: e2eFastAction,
            borrow: e2eFastAction,
            repay: e2eFastAction,
          })
        : createFastAdapter({
            deposit: depositNoteFast,
            withdraw: withdrawNoteFast,
            borrow: borrowNoteFast,
            repay: repayNoteFast,
          }),
    [borrowNoteFast, depositNoteFast, e2eFastAction, repayNoteFast, withdrawNoteFast],
  );

  const secureAdapter = useMemo(
    () =>
      shouldMockAdapters()
        ? createFastAdapter({
            deposit: e2eSecureAction,
            withdraw: e2eSecureAction,
            borrow: e2eSecureAction,
            repay: e2eSecureAction,
          })
        : createFastAdapter({
            deposit: secureDeposit,
            withdraw: secureWithdraw,
            borrow: secureBorrow,
            repay: secureRepay,
          }),
    [e2eSecureAction, secureBorrow, secureDeposit, secureRepay, secureWithdraw],
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
    myPosition,
    displayPosition,
    vaultStats,
    vaultAuthority,
    arciumClient,
    arciumKeypair,
    deposit,
    withdraw,
    borrow,
    repay,
    createInitialNote,
    rotateNote,
    initializeMerkleTree,
    clearNote,
    refreshNote,
    fastAdapter,
    noteFastAdapter,
    secureAdapter,
    isLoading,
    refresh,
    isMerkleTreeInitialized,
  };
};
