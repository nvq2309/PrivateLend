# Components and Ownership

```mermaid
flowchart TD
  subgraph Overview
    C[Client]
    O[On-chain]
    F[Off-chain]
    X[External Partners]
  end
  subgraph Detail
    UI[Frontend UI + Wallet (Phantom/Solflare)]
    SDK[SDK Core (Notes/Merkle/Tx)]
    BAL[Balance + Position Aggregator (SDK)]
    TX[Tx Orchestrator (SDK)]
    PROVER[ZK Prover (SnarkJS + Groth16)]
    OC[On-chain Program (Anchor)]
    MT[Merkle + Nullifier (Poseidon)]
    IDX[Indexer + API (Helius + Self-hosted)]
    DB[(Postgres + Redis)]
    H[RPC + Webhooks (Helius)]
    K[Underlying Lending Market (Kamino)]
    A[Client Encryption (Arcium)]
  end
  C --> UI --> SDK
  SDK --> BAL
  SDK --> TX --> OC
  SDK --> PROVER --> OC
  OC --> MT
  F --> IDX --> DB
  IDX --> H
  O --> OC
  X --> H
  X --> K
  X --> A
```

Container view (Primer-style)
- Client (Frontend UI + Wallet (Phantom/Solflare) + SDK Core + ZK Prover): owns note secrets and proof inputs; initiates transactions.
- On-chain program: owns vault state, Merkle roots, nullifier set; enforces LTV.
- Off-chain services: indexer/API for derived views and performance.
- External partners: RPC + Webhooks (Helius), Underlying Lending Market (Kamino), Client Encryption (Arcium).

Responsibilities and data ownership
- Client: note strings, proof cache, secrets (localStorage).
- On-chain: Vault, UserReceipt/NoteReceipt, MerkleTree, Nullifier.
- Indexer: derived balances/positions and audit logs (not authoritative).

Component responsibilities (high level)
- UI: user intent, error feedback, note management UX.
- SDK: proof orchestration, Merkle proofs, tx assembly, balance aggregation.
- On-chain: correctness enforcement (nullifier, LTV, root update).
- Indexer/API: read performance and history.

Scaling considerations
- Client compute scales per user; prover latency is user-local.
- On-chain compute scales with tx volume; Groth16 verify is a hotspot.
- Indexer scales with webhook throughput; queue decouples ingest and writes.

Interfaces (high level)
- UI → SDK: action requests + note operations.
- SDK → On-chain: instructions and proof/public inputs.
- Indexer → UI: cached views and history.
- On-chain → Underlying Lending Market (Kamino): CPI for borrow/repay (optional).

Tradeoffs
- Client-first proving reduces server trust but increases UX latency.
- Indexer improves UX but introduces eventual consistency risk.
