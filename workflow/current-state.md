# Current State (as of repo today)

## On-chain

- Merkle tree uses SHA-256 (programs/veillend/src/merkle.rs).
- Secure instructions exist:
  - deposit_secure
  - borrow_secure
  - repay_secure
  - withdraw_secure
  - deposit_secure_spend
- Nullifier PDA uses raw 32-byte nullifier as seed.
- Secure instructions verify Merkle proofs and mark nullifiers as spent.

## Client

- useVeilLend hook drives all actions with fastAdapter + secureAdapter.
- Proofs are currently demo-only (src/sdk/proof.ts) and not real ZK.
- Notes are JSON objects in localStorage (PrivacyNoteV2 in src/sdk/commitment.ts).
- UI derives positions from local privacy note aggregation, not on-chain proof.
- Note access records are saved as JSON for cross-wallet import.

## Mismatch vs new orders

- Positions are tracked client-side from JSON notes, not verified on-chain.
- Note format is JSON object instead of a single copyable note string.
- Proofs are not ZK and do not bind to Merkle root or LTV constraints.
