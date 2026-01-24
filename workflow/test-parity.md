# Test Parity (SC + UI)

## Principle

Every SECURE action scenario in UI tests must have the same logic in on-chain
tests (amounts, LTV checks, note rotation, nullifier usage).

## Required matching cases

- Supply SOL (secure): note -> merkle append -> new note
- Supply USDC (secure): same
- Borrow SOL (secure): LTV <= 70%, nullifier spent, new commitment
- Borrow USDC (secure): same
- Repay SOL/USDC (secure): cannot repay more than borrow
- Withdraw SOL/USDC (secure): LTV preserved after withdraw

## Snapshot constraints

- UI snapshots must reflect logical balances (wallet decreases, vault increases).
- Each step must keep arithmetic consistent (e.g., 5 SOL -> supply 1 SOL -> ~4 SOL).

## Change protocol

- Any change in tests requires updating PRD_VeilLend_UI_Todo.json
- Update Progress.txt with commands and pass/fail evidence
