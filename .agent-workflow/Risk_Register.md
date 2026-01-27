# Risk Register — VeilLend (ZK Rewrite)

Last updated: 2026-01-27

This register focuses on the risks that most commonly cause “infinite fail/fix loops” or prevent SECURE mode from becoming real.

Scoring (lightweight):
- Impact: High / Medium / Low
- Likelihood: High / Medium / Low
- Mitigation: what we do now (not “later”)

## R1 — Hash function mismatch (Poseidon vs SHA-256)
- Impact: High (SECURE proofs cannot verify end-to-end if assumptions mismatch)
- Likelihood: High (current artifacts indicate mixed assumptions)
- Early test:
  - Add a single “commitment alignment” test that compares:
    - client commitment
    - circuit commitment
    - on-chain commitment verification expectation
- Mitigation:
  - Record decision in ADR-0001 (blocking)
  - Standardize on ONE hashing scheme for commitments + Merkle proofs for SECURE mode
- Owner: TBD
- Status: open

## R2 — Proofs remain demo-only / not verified on-chain
- Impact: High (product is not actually secure)
- Likelihood: Medium–High (common integration stall)
- Early test:
  - Create a narrow slice: on-chain verify for `secure_supply` only
- Mitigation:
  - Slice-based wiring: S4 before full S5
  - Enforce “Evidence Gate” (no passes=true until on-chain verify evidence exists)
- Owner: TBD
- Status: open

## R3 — Compute budget exceeded during verifier transactions
- Impact: High (SECURE instructions fail on-chain)
- Likelihood: Medium (verifiers are compute-heavy)
- Early test:
  - Run a single secure verify transaction with compute budget set
- Mitigation:
  - Always attach `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` to verifier txs
  - Record constraints and any optimizations in ADR-0002
- Owner: TBD
- Status: open

## R4 — Transaction too large (>1232 bytes) in SECURE instructions
- Impact: High (tx fails regardless of correctness)
- Likelihood: Medium (proof inputs are large)
- Mitigation:
  - Minimize instruction args; derive values from accounts when possible
  - Optimize instruction data layout before considering ALTs
- Owner: TBD
- Status: open

## R5 — Harness instability (validator lifecycle + wrong CLI flags)
- Impact: Medium–High (wasted time; false failures)
- Likelihood: High (observed in logs)
- Early test:
  - Preflight gate that checks validator health and bootstrap success
- Mitigation:
  - Bake “pkill validator → start validator → bootstrap” into every test run
  - Document correct `anchor test --skip-local-validator -- --grep ...` usage
- Owner: TBD
- Status: open

## R6 — Dependency drift (missing test runner deps)
- Impact: Medium (tests don’t even start)
- Likelihood: Medium (observed in logs)
- Mitigation:
  - Ensure ts-mocha and required deps are in devDependencies
  - Add a “deps present” acceptance test (AT-HARNESS-003)
- Owner: TBD
- Status: open

## R7 — Privacy leaks via UI state/logging
- Impact: High (breaks privacy guarantee)
- Likelihood: Medium (easy to accidentally log secrets)
- Mitigation:
  - Threat model checklist in RUNBOOK / security notes
  - Avoid storing secrets in long-lived storage unless explicitly encrypted
  - Add “no secrets in logs” guardrails for dev builds (optional)
- Owner: TBD
- Status: open

## R8 — Smart contract semantics drift between FAST and SECURE
- Impact: Medium–High (hard-to-debug divergence)
- Likelihood: Medium
- Mitigation:
  - Parity tests: same action sequences, compare invariant outcomes
  - Keep FAST mode as baseline debugging tool
- Owner: TBD
- Status: open

## R9 — Wallet switching invalidates cached state
- Impact: Medium (stale note/position display)
- Likelihood: Medium
- Early test:
  - Multi-wallet UI flow: switch wallets and confirm caches reset
- Mitigation:
  - Clear wallet-specific caches on switch; re-fetch note and balances
- Owner: TBD
- Status: open

## R10 — Indexer/RPC lag causes stale balances
- Impact: Medium
- Likelihood: Medium
- Early test:
  - Simulate delayed refresh and verify UI shows pending/refresh states
- Mitigation:
  - Gate UI updates on confirmed txs; reconcile local note vs chain state
- Owner: TBD
- Status: open

## R11 — Decimal/rounding mismatches in balances
- Impact: Medium
- Likelihood: Medium
- Early test:
  - Unit tests for parse/format + boundary LTV calculations
- Mitigation:
  - Centralize conversion helpers; avoid mixed decimals in UI/SDK
- Owner: TBD
- Status: open
