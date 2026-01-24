# PRD (Workflow Extract)

This PRD is a workflow-local summary used to drive circuits + proof verification.
The canonical repo PRD remains in `mnt/data/PRD_03_VeilLend_Privacy_Lending_Broker.md`.

## Goals
- Replace demo proofs with real ZK proofs.
- Encode per-user positions inside note commitments.
- Enforce LTV checks in circuits (70%).

## Non-goals
- Interest accrual inside circuits (interest = 0).
- Price feeds in circuits (unit-based LTV only).

## Acceptance scope
- SECURE Supply/Borrow/Repay/Withdraw all require proofs.
- Note string is the only portable artifact for users.
- Nullifier + Merkle root updates happen on every secure action.
