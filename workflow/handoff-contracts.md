# Handoff Notes for Smart Contract Session

## Scope for contracts

- Replace current demo proof validation with real Groth16 verifier (snarkjs).
- Verify public inputs: merkleRoot, nullifierHash, oldCommitment, newCommitment.
- Enforce nullifier PDA for each action (already exists).
- Append new commitment to the Merkle tree after successful verification.

## Expected circuit outputs

- oldCommitment (public)
- newCommitment (public)
- nullifierHash (public)
- merkleRoot (public)

## Merkle tree

- Must use the same hash function as circuits (Poseidon).
- If keeping on-chain SHA-256 tree, the circuit must mirror SHA-256.
  Prefer switching on-chain to Poseidon for cheaper and consistent proofs.

## Note string

- Single ASCII string: veil-note-v1:<hex>
- Contract does not parse note; it only validates public inputs in proof.

## LTV

- Borrow LTV 70% enforced in circuit.
- On-chain can optionally recheck for safety but is not required.
