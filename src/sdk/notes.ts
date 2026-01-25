export type NoteRecord = {
  version: 1;
  walletAddress: string;
  noteHash: string;
  noteString?: string;
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

const toHex = (buffer: ArrayBuffer | Uint8Array) =>
  Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const buildNoteSeed = (params: {
  walletAddress: string;
  lastTxnId: string;
  timestamp: number;
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
  noteString?: string;
}): Promise<NoteRecord> => {
  const timestamp = params.timestamp ?? Date.now();
  const lastTxnId = normalizeTxnId(params.lastTxnId);
  const seed = buildNoteSeed({
    walletAddress: params.walletAddress,
    lastTxnId,
    timestamp,
  });
  const noteHash = await deriveNoteHash(seed);
  return {
    version: NOTE_VERSION,
    walletAddress: params.walletAddress,
    noteHash,
    noteString: params.noteString,
    lastTxnId,
    createdAt: params.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
};

export const createInitialNoteRecord = async (
  walletAddress: string,
  noteString?: string,
) => createNoteRecord({ walletAddress, lastTxnId: '0', noteString });

export const rotateNoteRecord = async (
  walletAddress: string,
  lastTxnId: string,
  previous?: NoteRecord,
  noteString?: string,
) => createNoteRecord({ walletAddress, lastTxnId, previous, noteString });

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

export const findNoteRecordByHash = (noteHash: string): NoteRecord | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const keys = Object.keys(localStorage).filter((key) => key.startsWith(`${NOTE_STORAGE_PREFIX}:`));
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as NoteRecord;
      if (parsed.version !== NOTE_VERSION) continue;
      if (parsed.noteHash === noteHash) {
        return parsed;
      }
    } catch (error) {
      console.warn('Failed to parse stored note', error);
    }
  }

  return null;
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
