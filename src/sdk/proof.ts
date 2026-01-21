import { deriveNoteHash } from './notes';

export type ProofArtifact = {
  proofHash: string;
  proofBlob: string;
  createdAt: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateDemoProof = async (params: {
  walletAddress: string;
  noteHash: string;
  lastTxnId: string;
}) => {
  const createdAt = Date.now();
  const payload = `${params.walletAddress}:${params.noteHash}:${params.lastTxnId}:${createdAt}`;
  await delay(650);
  const proofHash = await deriveNoteHash(payload);
  const proofBlob = await deriveNoteHash(`proof:${payload}`);
  return {
    proofHash,
    proofBlob,
    createdAt,
  } as ProofArtifact;
};
