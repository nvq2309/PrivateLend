# Partners and Integrations

```mermaid
flowchart LR
  subgraph Overview
    SDK[SDK Core (Notes/Merkle/Tx)] --> H[RPC + Webhooks (Helius)]
    OC[On-chain Program (Anchor)] --> K[Underlying Lending Market (Kamino)]
    SDK --> A[Client Encryption (Arcium)]
  end
  subgraph Detail
    H --> F1[Fallback: RPC Poll]
    K --> F2[Feature Flag Disable]
    A --> F3[Local Keypair]
  end
```

RPC + Webhooks (Helius)
- Provides webhooks and enhanced transactions for indexing.
- Fallback: direct RPC polling and reconciliation.

Underlying Lending Market (Kamino)
- Used for borrow/repay when accounts are supplied.
- Requires reserve/obligation refresh before CPI.
- Mitigation: feature flag to disable on incident.

Client Encryption (Arcium)
- Client keypair encrypts balance fields stored on-chain.
- Does not protect metadata or on-chain events.

Integration tradeoffs
- External dependencies improve UX but add failure modes.
- Each integration must have a degraded mode.

Trust boundaries
- RPC + Webhooks (Helius) and Underlying Lending Market (Kamino) are external dependencies; assume partial failures.
- Client Encryption (Arcium) protects encrypted balance fields only; not a privacy boundary for metadata.
