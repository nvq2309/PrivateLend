import { fromHex, toHex, type PrivacyNoteV2, resolveNoteAmounts } from './commitment';

export const NOTE_STRING_PREFIX = 'veil-note-v1:';

const toBytesBE = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
};

const fromBytesBE = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8n) + BigInt(bytes[i]);
  }
  return value;
};

export type NoteStringPayload = {
  nullifier: string;
  secret: string;
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
};

export const encodeNoteString = (payload: NoteStringPayload): string => {
  const parts = [
    fromHex(payload.nullifier),
    fromHex(payload.secret),
    toBytesBE(payload.supplySol, 8),
    toBytesBE(payload.supplyUsdc, 8),
    toBytesBE(payload.borrowSol, 8),
    toBytesBE(payload.borrowUsdc, 8),
    toBytesBE(payload.timestamp, 8),
  ];
  const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return `${NOTE_STRING_PREFIX}${toHex(buffer)}`;
};

export const decodeNoteString = (noteString: string): NoteStringPayload => {
  if (!noteString.startsWith(NOTE_STRING_PREFIX)) {
    throw new Error('Invalid note string format');
  }
  const hex = noteString.slice(NOTE_STRING_PREFIX.length);
  const bytes = fromHex(hex);
  if (bytes.length !== 104) {
    throw new Error('Invalid note string payload length');
  }
  let offset = 0;
  const take = (length: number) => {
    const slice = bytes.slice(offset, offset + length);
    offset += length;
    return slice;
  };
  const nullifier = toHex(take(32));
  const secret = toHex(take(32));
  const supplySol = fromBytesBE(take(8));
  const supplyUsdc = fromBytesBE(take(8));
  const borrowSol = fromBytesBE(take(8));
  const borrowUsdc = fromBytesBE(take(8));
  const timestamp = fromBytesBE(take(8));

  return {
    nullifier,
    secret,
    supplySol,
    supplyUsdc,
    borrowSol,
    borrowUsdc,
    timestamp,
  };
};

export const buildNoteStringFromPrivacyNote = (
  note: PrivacyNoteV2,
  collateralSymbol: 'SOL' | 'USDC',
): string => {
  const amounts = resolveNoteAmounts(note, collateralSymbol);
  return encodeNoteString({
    nullifier: note.nullifier,
    secret: note.blindingFactor,
    supplySol: amounts.supplySol,
    supplyUsdc: amounts.supplyUsdc,
    borrowSol: amounts.borrowSol,
    borrowUsdc: amounts.borrowUsdc,
    timestamp: amounts.timestamp,
  });
};
