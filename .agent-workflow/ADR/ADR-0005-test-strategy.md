# ADR-0005 — Test Strategy (Smoke vs Full Randomized + Parity)

Status: Proposed
Date: 2026-01-25

## Context
The repo already has heavy randomized tests and UI tests. The current pain point is iteration cost:
- developers run into harness failures
- full suites take too long for tight loops

We need a strategy that:
- keeps confidence for smart contracts
- keeps iteration fast

## Decision
Adopt a tiered strategy:

Tier 0 (Preflight): validator + bootstrap + deps
Tier 1 (Smoke): a small, deterministic subset of contract tests
Tier 2 (Targeted): grep-filtered tests for the feature under development
Tier 3 (Full): seeded randomized contract suite
Tier 4 (UI): Playwright smoke + optionally massive suite
Tier 5 (Parity): FAST vs SECURE invariant parity

## Alternatives considered
A) Run everything always
- max confidence, worst iteration speed.

B) Only unit tests
- fast, insufficient for Web3.

## Consequences
- Must keep smoke suite small and reliable.
- Full randomized runs should be scheduled (daily) rather than every edit.

## Verification
- Smoke: `anchor test --skip-local-validator -- --grep "Withdraw with LTV"`
- Full: `TEST_SEED="ci-test-run" anchor test --skip-local-validator`
- UI: `npx playwright test`
