# On-Chain Program Architecture

```mermaid
flowchart TD
  subgraph Overview
    V[Vault State] --> R[Receipts]
    V --> Z[Groth16 Verifier (syscalls)]
  end
  subgraph Detail
    UR[UserReceipt]
    NR[NoteReceipt]
    MT[MerkleTree (Poseidon)]
    N[Nullifier (Poseidon)]
  end
  R --> UR
  R --> NR
  Z --> MT --> N
```

State model (current)
- Vault: collateral mint, borrow mint, totals, LTV, pause flag.
- UserReceipt: wallet-based shares and debt.
- NoteReceipt: note hash-based shares and debt.
- MerkleTree: root, next index, filled subtrees.
- Nullifier: spent flag bound to vault.

PDA seeds (current)
- VAULT_SEED + collateral_mint
- USER_RECEIPT_SEED + vault + user
- NOTE_RECEIPT_SEED + vault + note_hash
- MERKLE_TREE_SEED + vault
- NULLIFIER_SEED + vault + nullifier

Instruction families
- FAST: user receipts, no ZK.
- NOTE_FAST: note receipts, limited privacy.
- SECURE: ZK verify + Merkle + Nullifier.

Outputs
- State updates: vault totals, receipt balances, Merkle root, nullifier spent.
- Events/logs: instruction success and updated roots (for indexer).

Correctness invariants
- Nullifier is single-use.
- Merkle root updated only by valid note insertions.
- LTV enforced at 70% on-chain.

Consistency model
- Strong consistency for vault totals, nullifier spend, and merkle root updates.
- Off-chain indexer views are eventually consistent.

Scaling and bottlenecks
- Groth16 verification is compute-heavy.
- CPI (Underlying Lending Market (Kamino)) adds account overhead and failure modes.
- Mitigations: compute unit limits, priority fees, feature flags.
