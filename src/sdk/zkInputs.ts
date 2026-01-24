import { fromHex, resolveNoteAmounts, type PrivacyNoteV2 } from './commitment';
import type { MerkleProof } from './merkle';
import { bytesToBigIntBE, poseidonHash } from './poseidon';
import type { ZkAction } from './zkProof';

type NoteFields = {
  nullifier: bigint;
  secret: bigint;
  supplySol: bigint;
  supplyUsdc: bigint;
  borrowSol: bigint;
  borrowUsdc: bigint;
  timestamp: bigint;
  commitment: bigint;
};

const toField = (bytes: Uint8Array) => bytesToBigIntBE(bytes);

const readNoteFields = (note: PrivacyNoteV2, collateralSymbol: 'SOL' | 'USDC'): NoteFields => {
  const amounts = resolveNoteAmounts(note, collateralSymbol);
  return {
    nullifier: toField(fromHex(note.nullifier)),
    secret: toField(fromHex(note.blindingFactor)),
    supplySol: amounts.supplySol,
    supplyUsdc: amounts.supplyUsdc,
    borrowSol: amounts.borrowSol,
    borrowUsdc: amounts.borrowUsdc,
    timestamp: amounts.timestamp,
    commitment: toField(fromHex(note.commitment)),
  };
};

const toFieldString = (value: bigint) => value.toString();

export const buildZkInputs = async (params: {
  action: ZkAction;
  oldNote: PrivacyNoteV2;
  newNote: PrivacyNoteV2;
  merkleProof: MerkleProof;
  collateralSymbol: 'SOL' | 'USDC';
  deltaAmount: bigint;
}): Promise<Record<string, string | string[] | number[]>> => {
  const oldFields = readNoteFields(params.oldNote, params.collateralSymbol);
  const newFields = readNoteFields(params.newNote, params.collateralSymbol);
  const deltaSupplySol = params.collateralSymbol === 'SOL' ? params.deltaAmount : 0n;
  const deltaSupplyUsdc = params.collateralSymbol === 'USDC' ? params.deltaAmount : 0n;
  const deltaBorrowSol = params.collateralSymbol === 'USDC' ? params.deltaAmount : 0n;
  const deltaBorrowUsdc = params.collateralSymbol === 'SOL' ? params.deltaAmount : 0n;
  const publicNullifierHash = await poseidonHash([oldFields.nullifier]);

  const baseInput = {
    merkleRoot: toFieldString(toField(params.merkleProof.root)),
    pathElements: params.merkleProof.proof.map((node) => toFieldString(toField(node))),
    pathIndices: params.merkleProof.path,
    oldNullifier: toFieldString(oldFields.nullifier),
    oldSecret: toFieldString(oldFields.secret),
    oldSupplySol: toFieldString(oldFields.supplySol),
    oldSupplyUsdc: toFieldString(oldFields.supplyUsdc),
    oldBorrowSol: toFieldString(oldFields.borrowSol),
    oldBorrowUsdc: toFieldString(oldFields.borrowUsdc),
    oldTimestamp: toFieldString(oldFields.timestamp),
    newNullifier: toFieldString(newFields.nullifier),
    newSecret: toFieldString(newFields.secret),
    newTimestamp: toFieldString(newFields.timestamp),
    publicNullifierHash: toFieldString(publicNullifierHash),
    publicOldCommitment: toFieldString(oldFields.commitment),
    publicNewCommitment: toFieldString(newFields.commitment),
  };

  switch (params.action) {
    case 'supply':
      return {
        ...baseInput,
        deltaSupplySol: toFieldString(deltaSupplySol),
        deltaSupplyUsdc: toFieldString(deltaSupplyUsdc),
      };
    case 'borrow':
      return {
        ...baseInput,
        deltaBorrowSol: toFieldString(deltaBorrowSol),
        deltaBorrowUsdc: toFieldString(deltaBorrowUsdc),
      };
    case 'repay':
      return {
        ...baseInput,
        deltaRepaySol: toFieldString(deltaBorrowSol),
        deltaRepayUsdc: toFieldString(deltaBorrowUsdc),
      };
    case 'withdraw':
      return {
        ...baseInput,
        deltaWithdrawSol: toFieldString(deltaSupplySol),
        deltaWithdrawUsdc: toFieldString(deltaSupplyUsdc),
      };
    default:
      return baseInput;
  }
};
