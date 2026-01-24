# Product Description (VeilLend)

## One-liner
Privacy-first lending broker on Solana using ZK notes + a Merkle tree to hide per-user positions.

## Target users
- Borrowers who want private collateral + debt positions.
- LPs who do not want observable strategies.

## Core flows
- Supply / Borrow / Repay / Withdraw with FAST and SECURE modes.
- SECURE mode uses ZK proofs + a Tornado-style note string.

## Success criteria
- All secure actions require proof verification and note rotation.
- UI displays positions based on verified note state.
- SC + UI tests share the same logical scenarios.
