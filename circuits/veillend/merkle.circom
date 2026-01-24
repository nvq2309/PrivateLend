pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

template MerkleProof(depth) {
  signal input leaf;
  signal input pathElements[depth];
  signal input pathIndices[depth];
  signal output root;

  signal current[depth + 1];
  current[0] <== leaf;

  component bit[depth];
  component hash[depth];
  signal left[depth];
  signal right[depth];
  signal leftMul1[depth];
  signal leftMul2[depth];
  signal rightMul1[depth];
  signal rightMul2[depth];

  for (var i = 0; i < depth; i++) {
    bit[i] = Num2Bits(1);
    bit[i].in <== pathIndices[i];

    leftMul1[i] <== current[i] * (1 - pathIndices[i]);
    leftMul2[i] <== pathElements[i] * pathIndices[i];
    left[i] <== leftMul1[i] + leftMul2[i];

    rightMul1[i] <== pathElements[i] * (1 - pathIndices[i]);
    rightMul2[i] <== current[i] * pathIndices[i];
    right[i] <== rightMul1[i] + rightMul2[i];

    hash[i] = Poseidon(2);
    hash[i].inputs[0] <== left[i];
    hash[i].inputs[1] <== right[i];
    current[i + 1] <== hash[i].out;
  }

  root <== current[depth];
}
