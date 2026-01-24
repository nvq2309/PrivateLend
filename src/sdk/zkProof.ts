export type ZkProofResult = {
  proof: unknown;
  publicSignals: string[];
};

export type ZkAction = 'supply' | 'borrow' | 'repay' | 'withdraw';

const getArtifactPaths = (action: ZkAction) => ({
  wasm: `/zk/${action}/${action}.wasm`,
  zkey: `/zk/${action}/setup_final.zkey`,
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
    proof: proofData.proof,
    publicSignals: proofData.publicSignals,
  };
};
