import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { computeCommitment, fromHex, toHex, type PrivacyNoteV2, resolveNoteAmounts } from './commitment';

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
  noteHash: string;
  vaultAddress: string;
  noteIndex: bigint;
  nullifier: string;
  secret: string;
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
};

export const encodeNoteString = (payload: NoteStringPayload): string => {
  const vaultBytes = new PublicKey(payload.vaultAddress).toBytes();
  const parts = [
    fromHex(payload.noteHash),
    vaultBytes,
    fromHex(payload.nullifier),
    fromHex(payload.secret),
    toBytesBE(payload.supplySol, 8),
    toBytesBE(payload.supplyUsdc, 8),
    toBytesBE(payload.borrowSol, 8),
    toBytesBE(payload.borrowUsdc, 8),
    toBytesBE(payload.timestamp, 8),
    toBytesBE(payload.noteIndex, 8),
  ];
  const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  const encoded = Buffer.from(buffer).toString('base64');
  return `${NOTE_STRING_PREFIX}${encoded}`;
};

export const decodeNoteString = (noteString: string): NoteStringPayload => {
  if (!noteString.startsWith(NOTE_STRING_PREFIX)) {
    throw new Error('Invalid note string format');
  }
  const encoded = noteString.slice(NOTE_STRING_PREFIX.length);
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  if (bytes.length !== 176) {
    throw new Error('Invalid note string payload length');
  }
  let offset = 0;
  const take = (length: number) => {
    const slice = bytes.slice(offset, offset + length);
    offset += length;
    return slice;
  };
  const noteHash = toHex(take(32));
  const vaultAddress = new PublicKey(take(32)).toBase58();
  const nullifier = toHex(take(32));
  const secret = toHex(take(32));
  const supplySol = fromBytesBE(take(8));
  const supplyUsdc = fromBytesBE(take(8));
  const borrowSol = fromBytesBE(take(8));
  const borrowUsdc = fromBytesBE(take(8));
  const timestamp = fromBytesBE(take(8));
  const noteIndex = fromBytesBE(take(8));

  return {
    noteHash,
    vaultAddress,
    noteIndex,
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
  noteHash: string,
): string => {
  const amounts = resolveNoteAmounts(note, collateralSymbol);
  return encodeNoteString({
    noteHash,
    vaultAddress: note.vaultAddress,
    noteIndex: BigInt(note.noteIndex),
    nullifier: note.nullifier,
    secret: note.blindingFactor,
    supplySol: amounts.supplySol,
    supplyUsdc: amounts.supplyUsdc,
    borrowSol: amounts.borrowSol,
    borrowUsdc: amounts.borrowUsdc,
    timestamp: amounts.timestamp,
  });
};

export const buildPrivacyNoteFromNoteString = async (params: {
  noteString: string;
  walletAddress: string;
  ownerPubkey: Uint8Array;
  collateralSymbol: 'SOL' | 'USDC';
}): Promise<PrivacyNoteV2> => {
  const payload = decodeNoteString(params.noteString);
  const commitment = await computeCommitment({
    nullifier: fromHex(payload.nullifier),
    secret: fromHex(payload.secret),
    supplySol: payload.supplySol,
    supplyUsdc: payload.supplyUsdc,
    borrowSol: payload.borrowSol,
    borrowUsdc: payload.borrowUsdc,
    timestamp: payload.timestamp,
  });
  const depositAmount =
    params.collateralSymbol === 'SOL' ? payload.supplySol : payload.supplyUsdc;
  const borrowAmount =
    params.collateralSymbol === 'SOL' ? payload.borrowUsdc : payload.borrowSol;

  return {
    version: 2,
    commitment,
    nullifier: payload.nullifier,
    blindingFactor: payload.secret,
    ownerPubkey: toHex(params.ownerPubkey),
    vaultAddress: payload.vaultAddress,
    depositAmount: depositAmount.toString(),
    borrowAmount: borrowAmount.toString(),
    collateralSymbol: params.collateralSymbol,
    supplySol: payload.supplySol.toString(),
    supplyUsdc: payload.supplyUsdc.toString(),
    borrowSol: payload.borrowSol.toString(),
    borrowUsdc: payload.borrowUsdc.toString(),
    noteIndex: Number(payload.noteIndex),
    createdAt: Number(payload.timestamp),
    spent: false,
  };
};
