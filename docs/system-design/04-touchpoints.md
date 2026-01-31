# Core Flows and Data Paths

```mermaid
flowchart TD
  subgraph Overview
    A[User Action]
    B[Balance Read Path]
    C[Transaction Path]
  end
  subgraph Detail
    B1[RPC + Indexer Read (Helius + Self-hosted)]
    B2[Balance + Position Aggregator (SDK)]
    B3[UI Position View]
    C1[SDK Build Inputs (Notes/Merkle)]
    C2[ZK Prover (SnarkJS + Groth16)]
    C3[Tx Submit + Confirm (Wallet + RPC)]
    C4[On-chain Verify (Anchor + Groth16)]
    C5[State Update + Note Rotation]
  end
  A --> B --> B1 --> B2 --> B3
  A --> C --> C1 --> C2 --> C3 --> C4 --> C5
```

Flow families
- FAST: wallet-based receipts, no ZK proof, fastest UX.
- NOTE_FAST: note receipts with reduced privacy guarantees.
- SECURE: ZK proof + Merkle inclusion + nullifier spend (privacy-first).

SECURE flow (borrow example)
1. UI selects action and vault.
2. SDK loads note, builds Merkle proof and ZK inputs.
3. ZK Prover (SnarkJS + Groth16) generates proof (or uses cached proof).
4. Transaction submits proof + public inputs to on-chain program.
5. On-chain verifies proof, checks root, marks nullifier, appends new commitment.
6. UI rotates note and refreshes balances.

Failure modes (must surface to UI)
- Proof verification fails (bad inputs or artifact mismatch).
- Root stale (proof built on a root no longer accepted).
- Nullifier already spent.
- CPI failure (Underlying Lending Market (Kamino)) or compute budget exceeded.

Transaction lifecycle (start → end)
- Start: UI action triggers SDK build inputs and proof.
- Submit: tx built, signed, sent to RPC.
- Confirm: signature confirmed; on-chain state updated.
- Return: UI receives signature + optional proof metadata; refreshes balances.

Balance handling (high level)
- Reads: wallet balances + vault stats + note aggregates.
- Compute: SDK aggregates positions (vaultStats + note totals).
- Display: UI shows position health, max borrow, and risk flags.

Consistency and idempotency
- On-chain state is authoritative; UI must reconcile with RPC if indexer lags.
- Replays are blocked by nullifier single-use enforcement.

Observability (what to track)
- Proof failure rate, root stale rate, CPI failures, tx compute budget exceeded.

Latency budget (theoretical)
- UI action → proof ready: p95 10-30 s (browser Groth16).
- Tx submit → confirm: p95 2-8 s.
- UI refresh after confirm: p95 < 1 s (indexer cached).

Tradeoffs
- SECURE is slower but privacy-preserving; FAST is quicker but less private.
- Proof caching improves UX but increases artifact/version coupling.
