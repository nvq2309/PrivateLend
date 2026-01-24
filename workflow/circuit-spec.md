# Circuit Spec (Target)

## Global constants

- LTV = 70% (borrow <= 0.7 * supplied)
- Interest = 0 (timestamp stored but not used in math)
- Hash: Poseidon (circomlib)
- Merkle tree depth: match on-chain (currently 8)

## Shared inputs (all action circuits)

### Private inputs

- note.nullifier (field)
- note.secret (field)
- note.supplySol (field)
- note.supplyUsdc (field)
- note.borrowSol (field)
- note.borrowUsdc (field)
- note.timestamp (field)
- merkle.pathElements[depth]
- merkle.pathIndices[depth]

### Public inputs

- merkleRoot
- nullifierHash
- oldCommitment
- newCommitment

## Common constraints

- oldCommitment == Poseidon(note fields)
- nullifierHash == Poseidon(note.nullifier)
- Merkle proof verifies oldCommitment at merkleRoot

## Action-specific constraints

### Supply

- Inputs: deltaSupplySol, deltaSupplyUsdc
- newSupplySol = note.supplySol + deltaSupplySol
- newSupplyUsdc = note.supplyUsdc + deltaSupplyUsdc
- newBorrowSol = note.borrowSol
- newBorrowUsdc = note.borrowUsdc
- newCommitment == Poseidon(new fields)

### Borrow

- Inputs: deltaBorrowSol, deltaBorrowUsdc
- newBorrowSol = note.borrowSol + deltaBorrowSol
- newBorrowUsdc = note.borrowUsdc + deltaBorrowUsdc
- LTV check:
  - newBorrowSol <= 0.7 * note.supplySol (if borrowSol used)
  - newBorrowUsdc <= 0.7 * note.supplyUsdc (if borrowUsdc used)
- newCommitment == Poseidon(new fields)

### Repay

- Inputs: deltaRepaySol, deltaRepayUsdc
- deltaRepay <= current borrow
- newBorrowSol = note.borrowSol - deltaRepaySol
- newBorrowUsdc = note.borrowUsdc - deltaRepayUsdc
- newCommitment == Poseidon(new fields)

### Withdraw

- Inputs: deltaWithdrawSol, deltaWithdrawUsdc
- newSupplySol = note.supplySol - deltaWithdrawSol
- newSupplyUsdc = note.supplyUsdc - deltaWithdrawUsdc
- LTV check after withdraw:
  - note.borrowSol <= 0.7 * newSupplySol
  - note.borrowUsdc <= 0.7 * newSupplyUsdc
- newCommitment == Poseidon(new fields)

## Output bindings

- newCommitment is public input for on-chain verification
- nullifierHash is public input for on-chain nullifier PDA
