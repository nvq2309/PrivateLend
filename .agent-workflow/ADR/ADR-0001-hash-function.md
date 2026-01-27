# ADR-0001 — Hash Function Unification (Poseidon vs SHA-256)

Status: Proposed
Date: 2026-01-25

## Context
The SECURE mode relies on commitments and Merkle proofs that must be consistent across:
- circuit constraints
- client-side commitment calculations
- on-chain verification expectations

If the hashing scheme differs across these components, proofs cannot verify end-to-end.

## Decision (needs operator choice)
Choose ONE scheme for SECURE commitments + Merkle proofs:

A) Poseidon everywhere
- Pros: matches typical ZK-friendly approach; fewer circuit constraints; aligns with current “ZK rewrite” direction.
- Cons: on-chain Poseidon may be compute-heavy; requires careful Solana implementation.

B) SHA-256 everywhere
- Pros: on-chain hashing is straightforward and well-tested.
- Cons: SHA-256 inside circuits can be expensive (more constraints), may reduce proving performance.

C) Hybrid (Poseidon in circuit, SHA-256 on-chain)
- Not recommended. Likely guarantees mismatch and makes verification brittle.

### Proposed recommendation
Recommendation: **A) Poseidon everywhere**, unless you have a hard reason to prefer SHA-256.

## Consequences
- If A is chosen: update on-chain hashing to Poseidon for SECURE commitments (or ensure the program verifies Poseidon-based roots/proofs).
- If B is chosen: refactor circuits to SHA-256 Merkle.
- In either case: add a “commitment alignment test” and treat it as a P0 gate.

## Verification
- `yarn test -- --grep "Commitment alignment"`
- SECURE end-to-end test (once wired): `anchor test --skip-local-validator -- --grep "SECURE end-to-end"`
