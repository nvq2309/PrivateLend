/**
 * Privacy Note System with Commitment Scheme
 *
 * Implements a note-based privacy system inspired by Zcash/Tornado Cash:
 * - Notes contain commitments to (balance, blinding_factor)
 * - Nullifiers prevent double-spending
 * - Proofs demonstrate note ownership without revealing balance
 *
 * Commitment: C = H(balance || blinding_factor || owner_pubkey)
 * Nullifier:  N = H(spending_key || note_index || commitment)
 */

export const toHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
};

export const concat = (...arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
};

import { bigintToBytesBE, bytesToBigIntBE, poseidonHash } from './poseidon';

export const bigintToBytes = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return bytes;
};

export interface PrivacyNoteV2 {
  version: 2;
  commitment: string;
  nullifier: string;
  blindingFactor: string;
  ownerPubkey: string;
  vaultAddress: string;
  depositAmount: string;
  borrowAmount: string;
  collateralSymbol?: 'SOL' | 'USDC';
  supplySol?: string;
  supplyUsdc?: string;
  borrowSol?: string;
  borrowUsdc?: string;
  noteIndex: number;
  createdAt: number;
  spent: boolean;
  spentTxnId?: string;
}

export interface NoteSecrets {
  blindingFactor: Uint8Array;
  spendingKey: Uint8Array;
}

export type NoteSecretsPayload = {
  blindingFactor: string;
  spendingKey: string;
};

const PRIVACY_NOTE_STORAGE_PREFIX = 'veillend.privacy_note.v2';
const SECRETS_STORAGE_PREFIX = 'veillend.secrets';

const storageKeyForWallet = (walletAddress: string) =>
  `${PRIVACY_NOTE_STORAGE_PREFIX}:${walletAddress}`;

const secretsKeyForWallet = (walletAddress: string) =>
  `${SECRETS_STORAGE_PREFIX}:${walletAddress}`;

export const generateBlindingFactor = (): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(32));
};

export const generateNullifier = (): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(32));
};

export const generateSpendingKey = (): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(32));
};

export const computeCommitment = async (params: {
  nullifier: Uint8Array;
  secret: Uint8Array;
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
}): Promise<string> => {
  const hash = await poseidonHash([
    bytesToBigIntBE(params.nullifier),
    bytesToBigIntBE(params.secret),
    params.supplySol,
    params.supplyUsdc,
    params.borrowSol,
    params.borrowUsdc,
    params.timestamp,
  ]);
  return toHex(bigintToBytesBE(hash, 32));
};

export const computeNullifierHash = async (nullifier: Uint8Array): Promise<string> => {
  const hash = await poseidonHash([bytesToBigIntBE(nullifier)]);
  return toHex(bigintToBytesBE(hash, 32));
};

export const resolveNoteAmounts = (
  note: PrivacyNoteV2,
  collateralSymbol: 'SOL' | 'USDC' = 'SOL',
): {
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
} => {
  const supplySol = note.supplySol ? BigInt(note.supplySol) : undefined;
  const supplyUsdc = note.supplyUsdc ? BigInt(note.supplyUsdc) : undefined;
  const borrowSol = note.borrowSol ? BigInt(note.borrowSol) : undefined;
  const borrowUsdc = note.borrowUsdc ? BigInt(note.borrowUsdc) : undefined;
  if (
    supplySol !== undefined
    && supplyUsdc !== undefined
    && borrowSol !== undefined
    && borrowUsdc !== undefined
  ) {
    return {
      supplySol,
      supplyUsdc,
      borrowSol,
      borrowUsdc,
      timestamp: BigInt(note.createdAt),
    };
  }

  const deposit = BigInt(note.depositAmount);
  const borrow = BigInt(note.borrowAmount);
  const symbol = note.collateralSymbol ?? collateralSymbol;
  return {
    supplySol: symbol === 'SOL' ? deposit : 0n,
    supplyUsdc: symbol === 'USDC' ? deposit : 0n,
    borrowSol: symbol === 'USDC' ? borrow : 0n,
    borrowUsdc: symbol === 'SOL' ? borrow : 0n,
    timestamp: BigInt(note.createdAt),
  };
};

export const initializeSecrets = (walletAddress: string): NoteSecrets => {
  if (typeof localStorage === 'undefined') {
    return {
      blindingFactor: generateBlindingFactor(),
      spendingKey: generateSpendingKey(),
    };
  }

  const existing = localStorage.getItem(secretsKeyForWallet(walletAddress));
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      return {
        blindingFactor: fromHex(parsed.blindingFactor),
        spendingKey: fromHex(parsed.spendingKey),
      };
    } catch {
    }
  }

  const secrets: NoteSecrets = {
    blindingFactor: generateBlindingFactor(),
    spendingKey: generateSpendingKey(),
  };

  localStorage.setItem(
    secretsKeyForWallet(walletAddress),
    JSON.stringify({
      blindingFactor: toHex(secrets.blindingFactor),
      spendingKey: toHex(secrets.spendingKey),
    }),
  );

  return secrets;
};

export const loadSecrets = (walletAddress: string): NoteSecrets | null => {
  if (typeof localStorage === 'undefined') return null;

  const raw = localStorage.getItem(secretsKeyForWallet(walletAddress));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      blindingFactor: fromHex(parsed.blindingFactor),
      spendingKey: fromHex(parsed.spendingKey),
    };
  } catch {
    return null;
  }
};

export const saveSecrets = (
  walletAddress: string,
  secrets: NoteSecrets | NoteSecretsPayload,
): void => {
  if (typeof localStorage === 'undefined') return;
  const isPayload = (input: NoteSecrets | NoteSecretsPayload): input is NoteSecretsPayload =>
    typeof input.blindingFactor === 'string';

  const payload = isPayload(secrets)
    ? secrets
    : {
        blindingFactor: toHex(secrets.blindingFactor),
        spendingKey: toHex(secrets.spendingKey),
      };
  localStorage.setItem(secretsKeyForWallet(walletAddress), JSON.stringify(payload));
};

export const createPrivacyNote = async (params: {
  walletAddress: string;
  ownerPubkey: Uint8Array;
  vaultAddress: string;
  depositAmount: bigint;
  borrowAmount: bigint;
  noteIndex: number;
  collateralSymbol?: 'SOL' | 'USDC';
}): Promise<PrivacyNoteV2> => {
  initializeSecrets(params.walletAddress);
  const nullifier = generateNullifier();
  const secret = generateBlindingFactor();
  const timestamp = Date.now();
  const symbol = params.collateralSymbol ?? 'SOL';
  const supplySol = symbol === 'SOL' ? params.depositAmount : 0n;
  const supplyUsdc = symbol === 'USDC' ? params.depositAmount : 0n;
  const borrowSol = symbol === 'USDC' ? params.borrowAmount : 0n;
  const borrowUsdc = symbol === 'SOL' ? params.borrowAmount : 0n;

  const commitment = await computeCommitment({
    nullifier,
    secret,
    supplySol,
    supplyUsdc,
    borrowSol,
    borrowUsdc,
    timestamp: BigInt(timestamp),
  });

  return {
    version: 2,
    commitment,
    nullifier: toHex(nullifier),
    blindingFactor: toHex(secret),
    ownerPubkey: toHex(params.ownerPubkey),
    vaultAddress: params.vaultAddress,
    depositAmount: params.depositAmount.toString(),
    borrowAmount: params.borrowAmount.toString(),
    collateralSymbol: symbol,
    supplySol: supplySol.toString(),
    supplyUsdc: supplyUsdc.toString(),
    borrowSol: borrowSol.toString(),
    borrowUsdc: borrowUsdc.toString(),
    noteIndex: params.noteIndex,
    createdAt: timestamp,
    spent: false,
  };
};

export const verifyNoteOwnership = async (
  note: PrivacyNoteV2,
  collateralSymbol: 'SOL' | 'USDC' = 'SOL',
): Promise<boolean> => {
  const resolved = resolveNoteAmounts(note, collateralSymbol);
  const recomputedCommitment = await computeCommitment({
    nullifier: fromHex(note.nullifier),
    secret: fromHex(note.blindingFactor),
    supplySol: resolved.supplySol,
    supplyUsdc: resolved.supplyUsdc,
    borrowSol: resolved.borrowSol,
    borrowUsdc: resolved.borrowUsdc,
    timestamp: resolved.timestamp,
  });

  return recomputedCommitment === note.commitment;
};

export const loadPrivacyNotes = (walletAddress: string): PrivacyNoteV2[] => {
  if (typeof localStorage === 'undefined') return [];

  const raw = localStorage.getItem(storageKeyForWallet(walletAddress));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n: PrivacyNoteV2) => n.version === 2);
  } catch {
    return [];
  }
};

export const savePrivacyNote = (walletAddress: string, note: PrivacyNoteV2): void => {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }

  const existing = loadPrivacyNotes(walletAddress);
  const updated = [...existing, note];
  localStorage.setItem(storageKeyForWallet(walletAddress), JSON.stringify(updated));
};

export const savePrivacyNotes = (walletAddress: string, notes: PrivacyNoteV2[]): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKeyForWallet(walletAddress), JSON.stringify(notes));
};

export const markNoteSpent = (
  walletAddress: string,
  nullifier: string,
  txnId: string,
): void => {
  if (typeof localStorage === 'undefined') return;

  const notes = loadPrivacyNotes(walletAddress);
  const updated = notes.map((note) => {
    if (note.nullifier === nullifier) {
      return { ...note, spent: true, spentTxnId: txnId };
    }
    return note;
  });

  localStorage.setItem(storageKeyForWallet(walletAddress), JSON.stringify(updated));
};

export const getUnspentNotes = (
  walletAddress: string,
  vaultAddress?: string,
): PrivacyNoteV2[] => {
  const notes = loadPrivacyNotes(walletAddress);
  return notes.filter((note) => {
    if (note.spent) return false;
    if (vaultAddress && note.vaultAddress !== vaultAddress) return false;
    return true;
  });
};

export const getNextNoteIndex = (walletAddress: string): number => {
  const notes = loadPrivacyNotes(walletAddress);
  if (notes.length === 0) return 0;
  return Math.max(...notes.map((n) => n.noteIndex)) + 1;
};

export const getAggregatedNotes = (
  walletAddress: string,
  vaultAddress?: string,
): PrivacyNoteV2[] => {
  const allNotes = loadPrivacyNotes(walletAddress);
  if (!vaultAddress) return allNotes;
  return allNotes.filter((note) => note.vaultAddress === vaultAddress);
};

export const getTotalBalance = (
  walletAddress: string,
  vaultAddress?: string,
): { deposit: bigint; borrow: bigint } => {
  const aggregated = getAggregatedNotes(walletAddress, vaultAddress);
  return aggregated.reduce(
    (acc, note) => ({
      deposit: acc.deposit + BigInt(note.depositAmount),
      borrow: acc.borrow + BigInt(note.borrowAmount),
    }),
    { deposit: 0n, borrow: 0n },
  );
};

export const clearPrivacyNotes = (walletAddress: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKeyForWallet(walletAddress));
  localStorage.removeItem(secretsKeyForWallet(walletAddress));
};

export const importPrivacyState = (
  sourceWalletAddress: string,
  targetWalletAddress: string,
): { copiedNotes: boolean; copiedSecrets: boolean } => {
  if (typeof localStorage === 'undefined') {
    return { copiedNotes: false, copiedSecrets: false };
  }

  const notes = loadPrivacyNotes(sourceWalletAddress);
  const copiedNotes = notes.length > 0;
  if (copiedNotes) {
    localStorage.setItem(storageKeyForWallet(targetWalletAddress), JSON.stringify(notes));
  }

  const secrets = localStorage.getItem(secretsKeyForWallet(sourceWalletAddress));
  const copiedSecrets = Boolean(secrets);
  if (secrets) {
    localStorage.setItem(secretsKeyForWallet(targetWalletAddress), secrets);
  }

  return { copiedNotes, copiedSecrets };
};
