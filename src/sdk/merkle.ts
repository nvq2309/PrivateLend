import { concat, sha256 } from './commitment';

export type MerkleProof = {
  proof: Uint8Array[];
  path: number[];
  root: Uint8Array;
};

const hashPair = async (left: Uint8Array, right: Uint8Array): Promise<Uint8Array> => {
  return sha256(concat(left, right));
};

const computeZeroHashes = async (depth: number): Promise<Uint8Array[]> => {
  const hashes: Uint8Array[] = [new Uint8Array(32)];
  for (let i = 0; i < depth; i += 1) {
    hashes.push(await hashPair(hashes[i], hashes[i]));
  }
  return hashes;
};

export const buildMerkleTree = async (
  leaves: Uint8Array[],
  depth: number,
): Promise<{ layers: Uint8Array[][]; root: Uint8Array }> => {
  const zeroHashes = await computeZeroHashes(depth);
  const maxLeaves = 1 << depth;
  const padded: Uint8Array[] = new Array(maxLeaves);
  for (let i = 0; i < maxLeaves; i += 1) {
    padded[i] = leaves[i] ?? zeroHashes[0];
  }

  const layers: Uint8Array[][] = [padded];
  for (let level = 0; level < depth; level += 1) {
    const prev = layers[level];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(await hashPair(prev[i], prev[i + 1]));
    }
    layers.push(next);
  }

  return { layers, root: layers[depth][0] };
};

export const getMerkleProof = async (
  leaves: Uint8Array[],
  index: number,
  depth: number,
): Promise<MerkleProof> => {
  const { layers, root } = await buildMerkleTree(leaves, depth);
  const proof: Uint8Array[] = [];
  const path: number[] = [];
  let currentIndex = index;

  for (let level = 0; level < depth; level += 1) {
    const siblingIndex = currentIndex ^ 1;
    proof.push(layers[level][siblingIndex]);
    path.push(currentIndex % 2);
    currentIndex = Math.floor(currentIndex / 2);
  }

  return { proof, path, root };
};
