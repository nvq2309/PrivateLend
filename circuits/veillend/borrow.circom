pragma circom 2.1.6;

include "./note.circom";
include "./merkle.circom";
include "./utils.circom";

template Borrow(depth) {
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

  signal input deltaBorrowSol;
  signal input deltaBorrowUsdc;

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
  deltaSolRc.in <== deltaBorrowSol;
  deltaUsdcRc.in <== deltaBorrowUsdc;

  signal newBorrowSol;
  signal newBorrowUsdc;
  newBorrowSol <== oldBorrowSol + deltaBorrowSol;
  newBorrowUsdc <== oldBorrowUsdc + deltaBorrowUsdc;

  component newBorrowSolRc = RangeCheck64();
  component newBorrowUsdcRc = RangeCheck64();
  newBorrowSolRc.in <== newBorrowSol;
  newBorrowUsdcRc.in <== newBorrowUsdc;

  component ltvSol = LtvCheck();
  ltvSol.borrow <== newBorrowSol;
  ltvSol.supply <== oldSupplySol;

  component ltvUsdc = LtvCheck();
  ltvUsdc.borrow <== newBorrowUsdc;
  ltvUsdc.supply <== oldSupplyUsdc;

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

component main {public [merkleRoot, publicNullifierHash, publicOldCommitment, publicNewCommitment]} = Borrow(8);
