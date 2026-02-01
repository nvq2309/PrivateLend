# Overview and Goals

```mermaid
flowchart LR
  subgraph Client
    U[User + Wallet (Phantom/Solflare)]
    UI[Frontend UI (React)]
    SDK[SDK Core (Notes/Merkle/Tx)]
    BAL[Balance + Position Aggregator (SDK)]
    TX[Tx Orchestrator (SDK)]
    PROVER[ZK Prover (SnarkJS + Groth16)]
  end
  subgraph OnChain
    OC[On-chain Program (Anchor)]
    ZK[Groth16 Verifier (syscalls)]
    MT[Merkle + Nullifier (Poseidon)]
  end
  subgraph OffChain
    IDX[Indexer + API (Helius + Self-hosted)]
    DB[(Postgres + Redis)]
  end
  subgraph Partners
    H[RPC + Webhooks (Helius)]
    K[Underlying Lending Market (Kamino)]
    A[Client Encryption (Arcium)]
  end
  U --> UI --> SDK
  SDK --> BAL
  SDK --> TX --> OC
  SDK --> PROVER --> OC
  OC --> ZK --> MT
  UI --> IDX --> DB
  IDX --> H
  OC --> K
  SDK --> A
```

Problem statement
- Provide privacy-first lending on Solana using note commitments, Merkle inclusion, and on-chain ZK verification.

Goals (current + near-term)
- Wallet-only UX: connect wallet, import/create note, generate proof, submit tx, rotate note.
- SECURE flows: supply/borrow/repay/withdraw with Groth16 verification on-chain.
- LTV enforcement at 70% on-chain.
- Optional Underlying Lending Market (Kamino) CPI for borrow/repay routing.

Non-goals (near-term)
- Interest accrual, liquidations, multi-asset oracles, custodial recovery.

Requirements and constraints (Primer-style)
- Functional: private note-based positions; on-chain enforcement of nullifier single-use.
- Non-functional: integrity first; availability limited by Solana RPC and compute.
- Cost drivers: proof generation latency, tx size, compute budget, RPC/indexer lag.
- Constraints: Poseidon everywhere, Groth16 proofs, Merkle depth = 4 today.

Capacity assumptions (fill in with target metrics)
- Daily active wallets, tx/day, proof generations/hour, indexer ingest rate.
- Peak concurrency: proof generation and CPI-heavy transactions.

Theoretical performance targets (planning only)
- CCU: 2k steady / 5k burst (UI sessions).
- API p95: 200-800 ms; p99: 1.5-3 s (indexer-backed reads).
- Proof generation p95: 10-30 s; p99: 45-90 s (browser Groth16).
- Tx confirmation p95: 2-8 s; p99: 10-20 s (Solana finality variance).
- Indexer lag p95: 5-30 s; p99: 2-5 min.

Architecture summary
- Client-first proving; on-chain verification and state transitions.
- Indexer/API for derived views only; on-chain remains authoritative.

Data flow (high level)
- User action → SDK builds Merkle proof + ZK inputs → Groth16 proof → on-chain verify → state update → UI refresh.

Bottlenecks and mitigations
- ZK verification compute: add compute unit limits + priority fees.
- Root staleness: near-term root history buffer + reconciliation.
- CPI failures: feature flag and degraded mode.

System context and trust boundaries
- Client: holds note secrets and proof inputs (most sensitive).
- On-chain: public state, nullifier set, Merkle roots (source of truth).
- Off-chain: indexer and cache for UX only (derived view).

Key tradeoffs
- Browser proving vs hosted proving: current is browser-only for privacy; higher latency.
- Indexer vs direct RPC reads: indexer improves UX but introduces eventual consistency.
- Privacy vs metadata leakage: note system hides amounts but timing/tx shape still leaks.

Known mismatches to resolve
- Circuit README mentions depth 8; on-chain + SDK use depth 4.

Near-term production posture
- HA active/passive deployment.
- Hybrid indexing: RPC + Webhooks (Helius) + self-hosted reconciliation.
- SIWS auth for API access with short-lived sessions.
