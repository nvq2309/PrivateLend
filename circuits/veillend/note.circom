pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "./utils.circom";

template NoteCommitment() {
  signal input nullifier;
  signal input secret;
  signal input supplySol;
  signal input supplyUsdc;
  signal input borrowSol;
  signal input borrowUsdc;
  signal input timestamp;

  signal output commitment;

  component supplySolRc = RangeCheck64();
  component supplyUsdcRc = RangeCheck64();
  component borrowSolRc = RangeCheck64();
  component borrowUsdcRc = RangeCheck64();
  component timestampRc = RangeCheck64();

  supplySolRc.in <== supplySol;
  supplyUsdcRc.in <== supplyUsdc;
  borrowSolRc.in <== borrowSol;
  borrowUsdcRc.in <== borrowUsdc;
  timestampRc.in <== timestamp;

  component hash = Poseidon(7);
  hash.inputs[0] <== nullifier;
  hash.inputs[1] <== secret;
  hash.inputs[2] <== supplySol;
  hash.inputs[3] <== supplyUsdc;
  hash.inputs[4] <== borrowSol;
  hash.inputs[5] <== borrowUsdc;
  hash.inputs[6] <== timestamp;

  commitment <== hash.out;
}

template NullifierHash() {
  signal input nullifier;
  signal output nullifierHash;

  component hash = Poseidon(2);
  hash.inputs[0] <== nullifier;
  hash.inputs[1] <== 0;
  nullifierHash <== hash.out;
}
