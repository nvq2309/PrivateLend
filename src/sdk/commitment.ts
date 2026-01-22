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
  noteIndex: number;
  createdAt: number;
  spent: boolean;
  spentTxnId?: string;
}

export interface NoteSecrets {
  blindingFactor: Uint8Array;
  spendingKey: Uint8Array;
}

const PRIVACY_NOTE_STORAGE_PREFIX = 'veillend.privacy_note.v2';
const SECRETS_STORAGE_PREFIX = 'veillend.secrets';

const storageKeyForWallet = (walletAddress: string) =>
  `${PRIVACY_NOTE_STORAGE_PREFIX}:${walletAddress}`;

const secretsKeyForWallet = (walletAddress: string) =>
  `${SECRETS_STORAGE_PREFIX}:${walletAddress}`;

export const generateBlindingFactor = (): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(32));
};

export const generateSpendingKey = (): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(32));
};

export const computeCommitment = async (params: {
  depositAmount: bigint;
  borrowAmount: bigint;
  blindingFactor: Uint8Array;
  ownerPubkey: Uint8Array;
}): Promise<string> => {
  const depositBytes = bigintToBytes(params.depositAmount, 8);
  const borrowBytes = bigintToBytes(params.borrowAmount, 8);
  const data = concat(depositBytes, borrowBytes, params.blindingFactor, params.ownerPubkey);
  const hash = await sha256(data);
  return toHex(hash);
};

export const computeNullifier = async (params: {
  spendingKey: Uint8Array;
  noteIndex: number;
  commitment: string;
}): Promise<string> => {
  const indexBytes = bigintToBytes(BigInt(params.noteIndex), 4);
  const commitmentBytes = fromHex(params.commitment);
  const data = concat(params.spendingKey, indexBytes, commitmentBytes);
  const hash = await sha256(data);
  return toHex(hash);
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

export const createPrivacyNote = async (params: {
  walletAddress: string;
  ownerPubkey: Uint8Array;
  vaultAddress: string;
  depositAmount: bigint;
  borrowAmount: bigint;
  noteIndex: number;
}): Promise<PrivacyNoteV2> => {
  const secrets = initializeSecrets(params.walletAddress);
  const blindingFactor = generateBlindingFactor();

  const commitment = await computeCommitment({
    depositAmount: params.depositAmount,
    borrowAmount: params.borrowAmount,
    blindingFactor,
    ownerPubkey: params.ownerPubkey,
  });

  const nullifier = await computeNullifier({
    spendingKey: secrets.spendingKey,
    noteIndex: params.noteIndex,
    commitment,
  });

  return {
    version: 2,
    commitment,
    nullifier,
    blindingFactor: toHex(blindingFactor),
    ownerPubkey: toHex(params.ownerPubkey),
    vaultAddress: params.vaultAddress,
    depositAmount: params.depositAmount.toString(),
    borrowAmount: params.borrowAmount.toString(),
    noteIndex: params.noteIndex,
    createdAt: Date.now(),
    spent: false,
  };
};

export const verifyNoteOwnership = async (
  note: PrivacyNoteV2,
  ownerPubkey: Uint8Array,
): Promise<boolean> => {
  const recomputedCommitment = await computeCommitment({
    depositAmount: BigInt(note.depositAmount),
    borrowAmount: BigInt(note.borrowAmount),
    blindingFactor: fromHex(note.blindingFactor),
    ownerPubkey,
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

export const getTotalBalance = (
  walletAddress: string,
  vaultAddress?: string,
): { deposit: bigint; borrow: bigint } => {
  const unspent = getUnspentNotes(walletAddress, vaultAddress);
  return unspent.reduce(
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
