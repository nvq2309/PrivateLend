# Test Plan — VeilLend

Last updated: 2026-01-27

This test plan is written to reduce wasted cycles from harness failures and to make agent execution deterministic.

## 0) Testing principles (rules)
1) If the validator is not running, do not debug “logic” failures. Fix harness first.
2) Prefer targeted tests while iterating; run the full randomized suite less frequently.
3) Every bug becomes a regression test.
4) Acceptance tests in `PRD.json` may be flipped to `passes=true` only with evidence recorded in `progress/Progress.txt`.

## 0.1) Test layers (pyramid)
- Unit tests: pure logic (encoding/decoding, math, hashing)
- Integration tests: module boundaries (UI↔SDK, SDK↔chain)
- Stateful/system tests: cross-action sequences (supply→borrow→repay→withdraw)
- Minimal UI E2E: focused smoke coverage with traces on failure

## 1) Preflight (must pass before any debugging)

A) Kill stale validators (prevents hangs / state bleed)
```bash
pkill -f solana-test-validator || true
pkill -f solana-faucet || true
```

B) Start validator (localnet)
```bash
COPYFILE_DISABLE=1 ./scripts/start-validator.sh  # macOS: prevents resource fork issues
```

C) Bootstrap localnet state
```bash
COPYFILE_DISABLE=1 ./scripts/bootstrap-localnet.sh  # macOS: prevents resource fork issues
```

D) Sanity: RPC reachable
```bash
curl -s http://127.0.0.1:8899 -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

## 2) Anchor / contract tests

### 2.1 Targeted test (fast loop)
When filtering tests, ensure grep is passed to mocha (not cargo-build-sbf):
```bash
anchor test --skip-local-validator -- --grep "Withdraw with LTV"
```

Notes:
- If you see an error like “Found argument '--grep' which wasn't expected” it usually means grep was passed to the wrong layer (build step), not to mocha. Fix the command invocation first.

### 2.2 Deterministic randomized suite (slower)
Use seeded runs for reproducibility:
```bash
TEST_SEED="ci-test-run" anchor test --skip-local-validator
```

## 3) UI tests (Playwright)

### 3.1 Quick smoke
```bash
npx playwright test
```

### 3.2 Massive randomized UI suite (slow)
```bash
TEST_SEED=my-seed npx playwright test tests/ui/massive_randomized.spec.ts
```

## 4) ZK artifacts + proof tests

Proof-related tests are split into:
- “pipeline” tests (witness/proof generation + caching)
- “on-chain verify” tests (secure instructions verify proofs)

The secure acceptance tests are intentionally reset to failing until proof verification is truly wired end-to-end.

## 4.1) Cross-functional integration tests (recommended)

When testing still feels painful, it is usually because tests are single-action and do not model real user flows.

Prefer adding at least one of these per slice:
- **State-machine tests**: generate multi-action sequences (supply→borrow→repay→withdraw...) and assert invariants at each step.
- **Parity tests (FAST vs SECURE)**: run the same scenario against both modes and ensure public-state invariants match.
- **Contract/interface snapshot tests**: freeze IDL/API shapes to prevent accidental breaking changes.

Parity test expectations:
- UI snapshots must reflect logical balances after each action.

Stateful cross-action testing (model-based):
- State = { wallet, positions, pendingTx, notes, balances }
- Actions = supply, borrow, repay, withdraw, switchWallet, exportNote, importNote, refresh
- Invariants after each action:
  - no negative balances
  - LTV ≤ 70% for SECURE flows
  - proofs correspond to the active wallet/note
  - wallet switch clears stale caches

Practical rule:
- Keep one small deterministic “smoke” scenario always-on.
- Keep larger randomized/stateful suites seeded and run them less frequently.

## 5) Failure triage (stop the painful loop)

### Symptom: ECONNREFUSED 127.0.0.1:8899
Cause: local validator is not running or tests are pointed to the wrong cluster.
Fix:
- run Preflight steps 0A–0D
- confirm Anchor.toml cluster is localnet
- rerun the targeted test

### Symptom: ts-mocha not found
Cause: JS dev dependencies missing or wrong package manager state.
Fix:
- `npm install` (preferred)
- confirm `node_modules/.bin/ts-mocha` exists
- rerun targeted tests

### Symptom: tests are flaky / state bleeds across runs
Fix:
- ALWAYS kill validator before rerun
- prefer deterministic seeded tests while debugging

## 7) Negative test requirement
- Include negative tests for signer/account constraints and invalid proofs in SECURE flows.

## 6) Evidence recording template
When you run tests, append to `progress/Progress.txt` using `.agent-workflow/Progress_template.txt`.
