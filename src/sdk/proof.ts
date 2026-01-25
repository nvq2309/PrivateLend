import type { PrivacyNoteV2 } from './commitment';
import type { MerkleProof } from './merkle';
import { bigintToBytesBE } from './poseidon';
import { buildZkInputs } from './zkInputs';
import {
  generateZkProof,
  type Groth16Proof,
  type ZkAction,
  type ZkProofResult,
} from './zkProof';

export type ZkActionProofParams = {
  action: ZkAction;
  oldNote: PrivacyNoteV2;
  newNote: PrivacyNoteV2;
  merkleProof: MerkleProof;
  collateralSymbol: 'SOL' | 'USDC';
  deltaAmount: bigint;
};

export type ZkProofArtifacts = ZkProofResult & { rawProof?: unknown };

const toFieldBytes = (value: bigint | string) =>
  Array.from(bigintToBytesBE(BigInt(value), 32));

const toGroth16Proof = (proof: any): Groth16Proof => ({
  aX: toFieldBytes(proof.pi_a[0]),
  aY: toFieldBytes(proof.pi_a[1]),
  bX0: toFieldBytes(proof.pi_b[0][0]),
  bX1: toFieldBytes(proof.pi_b[0][1]),
  bY0: toFieldBytes(proof.pi_b[1][0]),
  bY1: toFieldBytes(proof.pi_b[1][1]),
  cX: toFieldBytes(proof.pi_c[0]),
  cY: toFieldBytes(proof.pi_c[1]),
});

const isBrowser = () => typeof window !== 'undefined' && typeof window.document !== 'undefined';

const getNodeArtifacts = async (action: ZkAction) => {
  const path = await import('path');
  const root = process.cwd();
  return {
    wasm: path.resolve(root, `circuits/veillend/build/${action}/${action}_js/${action}.wasm`),
    zkey: path.resolve(root, `circuits/veillend/build/${action}/setup_final.zkey`),
    vkey: path.resolve(root, `circuits/veillend/build/${action}/verification_key.json`),
  };
};

export const generateZkActionProof = async (
  params: ZkActionProofParams,
): Promise<ZkProofArtifacts> => {
  const inputs = await buildZkInputs({
    action: params.action,
    oldNote: params.oldNote,
    newNote: params.newNote,
    merkleProof: params.merkleProof,
    collateralSymbol: params.collateralSymbol,
    deltaAmount: params.deltaAmount,
  });

  if (isBrowser()) {
    return generateZkProof(params.action, inputs);
  }

  const { groth16 } = await import('snarkjs');
  const { wasm, zkey } = await getNodeArtifacts(params.action);
  const proofData = await groth16.fullProve(inputs, wasm, zkey);
  return {
    proof: toGroth16Proof(proofData.proof),
    publicSignals: proofData.publicSignals,
    rawProof: proofData.proof,
  };
};

export const verifyZkActionProof = async (
  action: ZkAction,
  proof: ZkProofArtifacts,
): Promise<boolean> => {
  if (isBrowser()) {
    throw new Error('ZK proof verification is not supported in the browser');
  }
  if (!proof.rawProof) {
    throw new Error('Raw proof data required for verification');
  }

  const { groth16 } = await import('snarkjs');
  const { readFile } = await import('fs/promises');
  const { vkey } = await getNodeArtifacts(action);
  const vKeyJson = JSON.parse(await readFile(vkey, 'utf8'));
  return groth16.verify(vKeyJson, proof.publicSignals, proof.rawProof);
};

const NULLIFIER_STORAGE_KEY = 'veillend.nullifiers';

export const isNullifierSpent = (nullifier: string): boolean => {
  if (typeof localStorage === 'undefined') return false;

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  if (!raw) return false;

  try {
    const spent: string[] = JSON.parse(raw);
    return spent.includes(nullifier);
  } catch {
    return false;
  }
};

export const markNullifierSpent = (nullifier: string): void => {
  if (typeof localStorage === 'undefined') return;

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  const spent: string[] = raw ? JSON.parse(raw) : [];

  if (!spent.includes(nullifier)) {
    spent.push(nullifier);
    localStorage.setItem(NULLIFIER_STORAGE_KEY, JSON.stringify(spent));
  }
};

export const getSpentNullifiers = (): string[] => {
  if (typeof localStorage === 'undefined') return [];

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const clearNullifierRegistry = (): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(NULLIFIER_STORAGE_KEY);
};
