# Consolidated Requirements (Workflow Source of Truth)

This file merges the repo constraints (instruction.txt + PRD) with the
new ZK-first orders. It is the authoritative requirements slice that
feeds the workflow templates in this folder.

## Functional requirements

- FAST and SECURE modes exist for Supply/Borrow/Repay/Withdraw.
- SECURE actions require a valid ZK proof tied to a Merkle commitment.
- Each action nullifies the old note and appends a new commitment.
- Borrow is only allowed when borrow <= 70% supplied (interest = 0).
- UI positions are derived from verified note state, not wallet balances.

## Note requirements

- Single note string, ASCII only: `veil-note-v1:<hex>`.
- Exactly one active note per wallet at any time.
- Note rotation seed: `timestamp + walletAddress + lastTxnId`.

## Merkle requirements

- Merkle tree stores commitments only.
- Nullifier PDA prevents note reuse.
- Merkle hash must match circuits (prefer Poseidon).

## Verification + caching

- Proof verification is on-chain; UI caches verified results client-side.
- Cache invalidates on new note or merkle root change.

## Constraints

- Interest is 0 (timestamp stored but not used for accrual).
- LTV is fixed at 70%.
- No price feeds inside circuits; LTV uses same unit basis as note balances.
