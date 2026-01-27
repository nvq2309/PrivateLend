# ADR-0002 — Proof System + On-Chain Verifier Interface

Status: Proposed
Date: 2026-01-25

## Context
SECURE instructions must verify real ZK proofs on-chain. The proof system choice affects:
- artifact pipeline (keys, zkeys, wasm)
- verifier performance (compute budget)
- client SDK complexity
- upgrade/versioning strategy

## Decision (needs operator choice)

A) Groth16 (snarkjs)
- Pros: mature tooling; fast verification; common in web-based proving.
- Cons: requires careful artifact management; trusted setup.

B) Plonk / other universal schemes
- Pros: can reduce per-circuit ceremony.
- Cons: different tooling; may be heavier; only choose if already standardized.

C) Stub verifier for UI demo (explicitly non-secure)
- Pros: fastest demo.
- Cons: not a real secure system; must be treated as non-production.

### Proposed recommendation
Recommendation: **A) Groth16**, unless there is already a Plonk-based stack chosen.

## Consequences
- Verifier transactions likely need explicit compute budget settings.
- Verifying key storage and versioning becomes a first-class concern (avoid mismatched keys).

## Verification
- `anchor test --skip-local-validator -- --grep "SECURE supply"`
- `anchor test --skip-local-validator -- --grep "SECURE end-to-end"`
