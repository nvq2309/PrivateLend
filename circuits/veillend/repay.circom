pragma circom 2.1.6;

include "./note.circom";
include "./merkle.circom";
include "./utils.circom";

template Repay(depth) {
  signal input merkleRoot;
  signal input pathElements[depth];
  signal input pathIndices[depth];

  signal input oldNullifier;
  signal input oldSecret;
  signal input oldSupplySol;
  signal input oldSupplyUsdc;
  signal input oldBorrowSol;
  signal input oldBorrowUsdc;
  signal input oldTimestamp;

  signal input deltaRepaySol;
  signal input deltaRepayUsdc;

  signal input newNullifier;
  signal input newSecret;
  signal input newTimestamp;

  signal input publicNullifierHash;
  signal input publicOldCommitment;
  signal input publicNewCommitment;

  component oldNote = NoteCommitment();
  oldNote.nullifier <== oldNullifier;
  oldNote.secret <== oldSecret;
  oldNote.supplySol <== oldSupplySol;
  oldNote.supplyUsdc <== oldSupplyUsdc;
  oldNote.borrowSol <== oldBorrowSol;
  oldNote.borrowUsdc <== oldBorrowUsdc;
  oldNote.timestamp <== oldTimestamp;
  signal oldCommitment;
  oldCommitment <== oldNote.commitment;

  component nullHash = NullifierHash();
  nullHash.nullifier <== oldNullifier;
  signal nullifierHash;
  nullifierHash <== nullHash.nullifierHash;

  component proof = MerkleProof(depth);
  proof.leaf <== oldCommitment;
  proof.pathElements <== pathElements;
  proof.pathIndices <== pathIndices;
  proof.root === merkleRoot;

  component deltaSolRc = RangeCheck64();
  component deltaUsdcRc = RangeCheck64();
  deltaSolRc.in <== deltaRepaySol;
  deltaUsdcRc.in <== deltaRepayUsdc;

  component repaySolOk = AssertLessEq(64);
  component repayUsdcOk = AssertLessEq(64);
  repaySolOk.a <== deltaRepaySol;
  repaySolOk.b <== oldBorrowSol;
  repayUsdcOk.a <== deltaRepayUsdc;
  repayUsdcOk.b <== oldBorrowUsdc;

  signal newBorrowSol;
  signal newBorrowUsdc;
  newBorrowSol <== oldBorrowSol - deltaRepaySol;
  newBorrowUsdc <== oldBorrowUsdc - deltaRepayUsdc;

  component newBorrowSolRc = RangeCheck64();
  component newBorrowUsdcRc = RangeCheck64();
  newBorrowSolRc.in <== newBorrowSol;
  newBorrowUsdcRc.in <== newBorrowUsdc;

  component newNote = NoteCommitment();
  newNote.nullifier <== newNullifier;
  newNote.secret <== newSecret;
  newNote.supplySol <== oldSupplySol;
  newNote.supplyUsdc <== oldSupplyUsdc;
  newNote.borrowSol <== newBorrowSol;
  newNote.borrowUsdc <== newBorrowUsdc;
  newNote.timestamp <== newTimestamp;
  signal newCommitment;
  newCommitment <== newNote.commitment;

  publicNullifierHash === nullifierHash;
  publicOldCommitment === oldCommitment;
  publicNewCommitment === newCommitment;
}

component main {public [merkleRoot, publicNullifierHash, publicOldCommitment, publicNewCommitment]} = Repay(4);
