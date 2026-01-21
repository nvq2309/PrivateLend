export type NoteRecord = {
  version: 1;
  walletAddress: string;
  noteHash: string;
  lastTxnId: string;
  createdAt: number;
  updatedAt: number;
};

const NOTE_STORAGE_PREFIX = 'veillend.note';
const NOTE_VERSION: NoteRecord['version'] = 1;
const textEncoder = new TextEncoder();

const storageKeyForWallet = (walletAddress: string) =>
  `${NOTE_STORAGE_PREFIX}:${walletAddress}`;

const normalizeTxnId = (lastTxnId: string | number | null | undefined) => {
  if (lastTxnId === null || lastTxnId === undefined || lastTxnId === '') {
    return '0';
  }
  return String(lastTxnId);
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const buildNoteSeed = (params: {
  timestamp: number;
  walletAddress: string;
  lastTxnId: string;
}) => `${params.timestamp}:${params.walletAddress}:${params.lastTxnId}`;

export const deriveNoteHash = async (seed: string) => {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto is unavailable for note hashing');
  }
  const bytes = textEncoder.encode(seed);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
};

export const createNoteRecord = async (params: {
  walletAddress: string;
  lastTxnId: string | number | null | undefined;
  timestamp?: number;
  previous?: NoteRecord;
}): Promise<NoteRecord> => {
  const timestamp = params.timestamp ?? Date.now();
  const lastTxnId = normalizeTxnId(params.lastTxnId);
  const seed = buildNoteSeed({
    timestamp,
    walletAddress: params.walletAddress,
    lastTxnId,
  });
  const noteHash = await deriveNoteHash(seed);
  return {
    version: NOTE_VERSION,
    walletAddress: params.walletAddress,
    noteHash,
    lastTxnId,
    createdAt: params.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
};

export const createInitialNoteRecord = async (walletAddress: string) =>
  createNoteRecord({ walletAddress, lastTxnId: '0' });

export const rotateNoteRecord = async (
  walletAddress: string,
  lastTxnId: string,
  previous?: NoteRecord,
) => createNoteRecord({ walletAddress, lastTxnId, previous });

export const loadNoteRecord = (walletAddress: string): NoteRecord | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(storageKeyForWallet(walletAddress));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NoteRecord;
    if (parsed.walletAddress !== walletAddress || parsed.version !== NOTE_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse stored note', error);
    return null;
  }
};

export const saveNoteRecord = (note: NoteRecord) => {
  if (typeof localStorage === 'undefined') {
    throw new Error('Local storage is unavailable');
  }
  localStorage.setItem(storageKeyForWallet(note.walletAddress), JSON.stringify(note));
};

export const clearNoteRecord = (walletAddress: string) => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem(storageKeyForWallet(walletAddress));
};
