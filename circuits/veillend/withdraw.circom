pragma circom 2.1.6;

include "./note.circom";
include "./merkle.circom";
include "./utils.circom";

template Withdraw(depth) {
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

  signal input deltaWithdrawSol;
  signal input deltaWithdrawUsdc;

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
  deltaSolRc.in <== deltaWithdrawSol;
  deltaUsdcRc.in <== deltaWithdrawUsdc;

  component withdrawSolOk = AssertLessEq(64);
  component withdrawUsdcOk = AssertLessEq(64);
  withdrawSolOk.a <== deltaWithdrawSol;
  withdrawSolOk.b <== oldSupplySol;
  withdrawUsdcOk.a <== deltaWithdrawUsdc;
  withdrawUsdcOk.b <== oldSupplyUsdc;

  signal newSupplySol;
  signal newSupplyUsdc;
  newSupplySol <== oldSupplySol - deltaWithdrawSol;
  newSupplyUsdc <== oldSupplyUsdc - deltaWithdrawUsdc;

  component newSupplySolRc = RangeCheck64();
  component newSupplyUsdcRc = RangeCheck64();
  newSupplySolRc.in <== newSupplySol;
  newSupplyUsdcRc.in <== newSupplyUsdc;

  component ltvSol = LtvCheck();
  ltvSol.borrow <== oldBorrowSol;
  ltvSol.supply <== newSupplySol;

  component ltvUsdc = LtvCheck();
  ltvUsdc.borrow <== oldBorrowUsdc;
  ltvUsdc.supply <== newSupplyUsdc;

  component newNote = NoteCommitment();
  newNote.nullifier <== newNullifier;
  newNote.secret <== newSecret;
  newNote.supplySol <== newSupplySol;
  newNote.supplyUsdc <== newSupplyUsdc;
  newNote.borrowSol <== oldBorrowSol;
  newNote.borrowUsdc <== oldBorrowUsdc;
  newNote.timestamp <== newTimestamp;
  signal newCommitment;
  newCommitment <== newNote.commitment;

  publicNullifierHash === nullifierHash;
  publicOldCommitment === oldCommitment;
  publicNewCommitment === newCommitment;
}

component main {public [merkleRoot, publicNullifierHash, publicOldCommitment, publicNewCommitment]} = Withdraw(8);
