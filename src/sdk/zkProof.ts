import { bigintToBytesBE } from './poseidon';

export interface Groth16Proof {
  aX: number[];
  aY: number[];
  bX0: number[];
  bX1: number[];
  bY0: number[];
  bY1: number[];
  cX: number[];
  cY: number[];
}

export type ZkProofResult = {
  proof: Groth16Proof;
  publicSignals: string[];
};

export type ZkAction = 'supply' | 'borrow' | 'repay' | 'withdraw';

const getArtifactPaths = (action: ZkAction) => ({
  wasm: `/zk/${action}/${action}.wasm`,
  zkey: `/zk/${action}/setup_final.zkey`,
});

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

export const generateZkProof = async (
  action: ZkAction,
  input: Record<string, unknown>,
): Promise<ZkProofResult> => {
  const { wasm, zkey } = getArtifactPaths(action);
  const snarkjs = await import('snarkjs');
  const { groth16 } = snarkjs;

  const response = await fetch(wasm);
  if (!response.ok) {
    throw new Error(`Missing wasm artifact at ${wasm}`);
  }

  const proofData = await groth16.fullProve(input, wasm, zkey);
  return {
    proof: toGroth16Proof(proofData.proof),
    publicSignals: proofData.publicSignals,
  };
};
