# PRD (Template)

This is a narrative spec. It should be understandable to humans and agents.
The structured mirror is `PRD.json`.

1) Overview
- Problem:
- Users:
- Value proposition:
- Success metrics (quantitative where possible):

2) Scope
2.1 Goals
2.2 Non-goals
2.3 Constraints
2.4 Dependencies

3) User stories (prioritized)
Use P0/P1/P2.
- US01 (P0): As a ..., I want ..., so that ...
- ...

4) UX / flows
For each key flow:
- Preconditions
- Steps
- Error states
- Empty/loading states

5) Functional requirements
Grouped by module: UI / Backend / Smart Contracts / Indexer / Wallet / Admin.

6) Non-functional requirements
- Performance
- Reliability
- Security / privacy
- Observability (logs, traces, metrics)
- Accessibility

7) Data model (high-level)
- Entities
- On-chain accounts/state
- Off-chain storage
- Event schema

8) Interface contracts (must be stable to enable parallel build)
- API contract (OpenAPI or typed contract)
- ABI/IDL contract (generated client; event schema)
- Shared types package

9) Threat model (Web3)
- Key management assumptions
- Attacker model
- Funds safety assumptions
- Frontend integrity assumptions

10) Rollout and demo plan
- Environments: localnet/devnet/testnet/mainnet
- Feature flags
- Demo script

11) Acceptance tests mapping
Reference the IDs in PRD.json.
- P0 requirement → Acceptance test IDs

