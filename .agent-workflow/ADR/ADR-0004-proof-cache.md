# ADR-0004 — Proof Cache + Artifact Versioning

Status: Proposed
Date: 2026-01-25

## Context
Generating ZK proofs can be slow. We need caching to improve iteration speed and UX.
But caching can create correctness risk if cache invalidation is wrong (stale proofs).

## Decision
Proposed approach:
- Cache key = hash(circuit_id, circuit_artifact_version, public_inputs_hash, private_inputs_hash)
- Cache storage:
  - Dev: local filesystem or localStorage (explicitly dev-only)
  - Demo: localStorage with size limits and clear UI controls

## Alternatives considered
A) No cache
- simplest but slow.

B) Cache by note string only
- faster but too coarse; invalidation risk.

## Consequences
- Must include artifact version in cache key.
- Must provide a way to clear cache for debugging.

## Verification
- `yarn test -- --grep "Proof cache"`
