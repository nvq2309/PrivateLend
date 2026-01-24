# Test Plan (ZK Rewrite)

## Objective
Verify SECURE actions enforce proof verification + note rotation, and FAST flows remain functional.

## Prerequisites
- Local validator running
- Circuits compiled + proving keys generated
- Verifier deployed on-chain

## Test cases
1. Supply SECURE: proof verifies, commitment appended, new note produced.
2. Borrow SECURE: LTV 70% enforced by circuit, nullifier spent, new note produced.
3. Repay SECURE: cannot repay more than borrow.
4. Withdraw SECURE: LTV preserved after withdraw.
5. UI snapshots: balances change logically per step.

## Success criteria
All test cases pass; evidence logged in Progress.txt.
