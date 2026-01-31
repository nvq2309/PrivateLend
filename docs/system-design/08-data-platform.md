# Data Platform and Infrastructure

```mermaid
flowchart LR
  subgraph Overview
    RPC[Solana RPC] --> H[RPC + Webhooks (Helius)]
    H --> IDX[Indexer + API (Helius + Self-hosted)]
    IDX --> API[Read API]
    API --> UI[Frontend UI (React)]
  end
  subgraph Detail
    Q[Queue] --> IDX
    IDX --> PG[(Postgres)]
    IDX --> R[(Redis)]
    IDX --> REC[Reconciler]
  end
```

Why off-chain exists
- Reduce UX latency for balances/positions and history.
- Enable reconciliation and monitoring.

Consistency model
- On-chain state is authoritative.
- Indexer is eventually consistent; UI must tolerate drift.

Scaling and bottlenecks
- Webhook throughput and backfills are the main pressure points.
- Queue decouples ingestion from indexing.

Storage and caching
- Postgres: events, derived positions, audit logs.
- Redis: cache hot views, SIWS nonces, rate limits.

Data model (high level)
- Event log (tx signature, instruction, vault id).
- Derived position snapshots (per wallet/note).
- Merkle root history cache for UI.

Reliability considerations
- Reconcile worker recomputes roots/positions to detect drift.
- Fallback to RPC reads if indexer lag exceeds threshold.

Theoretical latency targets (planning only)
- API read p95: 200-800 ms; p99: 1.5-3 s.
- Indexer lag p95: 5-30 s; p99: 2-5 min.
