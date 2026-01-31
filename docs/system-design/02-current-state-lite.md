# Current State (Lite)

```mermaid
flowchart TB
  subgraph Overview
    C1[Current System]
    P1[Near-term Hardening]
  end
  subgraph Detail
    C2[Wallet (Phantom/Solflare) + UI]
    C3[Note String + LocalStorage]
    C4[ZK Prover (SnarkJS + Groth16)]
    C5[On-chain Verifier + Merkle]
    P2[Root History Buffer]
    P3[Indexer + API (Helius + Self-hosted)]
    P4[SIWS API Auth]
  end
  C1 --> C2 --> C3 --> C4 --> C5
  P1 --> P2 --> P3 --> P4
```

Current implementation snapshot (one screen)
- Wallet (Phantom/Solflare) + UI via Solana wallet adapter.
- Note string format (veil-note-v1) stored in localStorage.
- Poseidon commitments + nullifiers; Merkle proofs built client-side.
- ZK Prover (SnarkJS + Groth16) in browser; proof cache in localStorage.
- On-chain verifier checks Merkle inclusion and marks nullifiers spent.
- LTV fixed at 70% on-chain.
- Optional Underlying Lending Market (Kamino) CPI for borrow/repay when accounts supplied.
- Client Encryption (Arcium) for encrypted balance fields.

Current architecture stack
- Client: React + wallet adapter + SDK core + SnarkJS.
- On-chain: Anchor program + Merkle + Groth16 verifier syscalls.
- Off-chain: RPC + Webhooks (Helius) with local caching.

Near-term hardening snapshot
- Merkle root history buffer (64 roots) to reduce stale proof failures.
- Indexer + API (Helius + Self-hosted) reconciliation to detect root drift.
- SIWS-based API auth for indexer/prover access.

Known mismatch
- Merkle depth: circuits mention depth 8; on-chain + SDK use depth 4.
