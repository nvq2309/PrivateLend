# Security and Operations

```mermaid
flowchart TB
  subgraph Overview
    Auth[SIWS Auth (Wallet (Phantom/Solflare))] --> Sessions[Short Sessions]
    ZK[Proofs] --> Verify[Groth16 Verify (syscalls)]
    Ops[Ops Signals] --> Action[Operator Actions]
  end
  subgraph Detail
    Logs[Metrics/Logs] --> Alert[Alerts]
    Alert --> Pause[Pause Vault]
    Alert --> Disable[Disable Underlying Lending Market (Kamino)]
    Alert --> Reindex[Reconcile Indexer]
  end
```

Threat model highlights
- Note strings are bearer instruments; never log or transmit to analytics.
- Client compromise is out of scope; treat localStorage as sensitive.
- Metadata leakage (timing, tx shape) remains possible.

Auth and rate limiting
- SIWS nonces are single-use with TTL.
- Sessions are short-lived and bound to domain/chain.
- Rate limits by wallet + IP.

Reliability signals
- Proof failure rate spikes.
- Indexer lag and root drift.
- CPI failure rate (Underlying Lending Market (Kamino)).

Runbooks (near-term)
- RPC outage: switch provider, pause secure flows.
- Indexer lag: fall back to RPC reads, reindex.
- Proof failures: verify artifact versions and public input binding.

Operational controls
- Feature flags for CPI routes.
- Emergency pause on vaults.
- Alerting on proof failure spikes and root drift.

SLO targets (theoretical)
- Proof failure rate < 1% p95 window.
- Indexer lag alert at > 2 minutes.
- CPI failure rate alert at > 5%.
