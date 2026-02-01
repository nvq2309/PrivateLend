# UI and SDK Architecture

```mermaid
flowchart LR
  subgraph Overview
    UI[Frontend UI (React) State] --> H[useVeilLend Hook]
    H --> SDK[SDK Core (Notes/Merkle/Tx)]
  end
  subgraph Detail
    BAL[Balance + Position Aggregator (SDK)]
    N[Note Model (Note Strings)]
    C[Commitment + Nullifier (Poseidon)]
    M[Merkle Builder (Poseidon)]
    P[ZK Prover (SnarkJS + Groth16)]
    T[Tx Orchestrator (SDK)]
    S[Signer + Submit (Wallet + RPC)]
    LS[(localStorage)]
  end
  SDK --> BAL
  SDK --> N --> LS
  SDK --> C --> M --> P --> T --> S
```

Client boundaries
- UI: collects user intent and renders state.
- Hook layer: standardizes calls into SDK and on-chain.
- SDK: note model, Merkle proof, ZK inputs, ZK Prover (SnarkJS + Groth16), tx assembly.

Client data model
- Note strings and secrets in localStorage (per wallet).
- Proof cache keyed by inputs and artifact version.

Artifact management (best practice)
- Proof artifacts are versioned and invalidated on circuit updates.
- UI should surface artifact mismatch and force re-prove.

SIWS boundary (near-term)
- UI uses SIWS to access indexer/prover endpoints.
- Nonce and session TTL enforced server-side.

Public SDK surfaces (high level)
- create/import note, get balances/positions, build proof, submit tx.

Caching strategy
- Proof cache (client): reduce repeated proving for same inputs.
- Indexer cache (server): reduce RPC load for balances/positions.

Failure handling
- Surface artifact mismatch and proof failures with re-prove guidance.

Transaction lifecycle (client side)
- Build instructions → sign → submit → confirm → return signature and proof metadata.

Balance handling
- Reads from RPC/indexer are normalized into vaultStats + position view.

Tradeoffs
- Local proofs preserve privacy; compute cost lives on the client.
