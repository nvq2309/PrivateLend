# Test Plan (Template)

Goal: minimize ad-hoc manual QA by making failures deterministic, reproducible, and automatically checked.

1) Test layers (the “pyramid”)
- Unit tests: pure functions, reducers, math, encoding/decoding, serialization.
- Integration tests: module boundaries (UI↔API, Backend↔Chain, Chain↔Indexer).
- Stateful/system tests: cross-action sequences with generated scenarios.
- Minimal UI E2E: a small number of smoke tests; use traces for debugging.

2) Deterministic Web3 harness
- Local chain (localnet/anvil/hardhat/solana-test-validator).
- Seeded wallets/accounts with deterministic keys.
- Bootstrap script that creates all required on-chain/off-chain state.
- Reset between tests (fresh ledger/db) to prevent flakiness.

3) Interface contract tests
- UI↔Backend contract: consumer-driven contract tests (Pact or equivalent).
- UI↔Chain contract: generated client from ABI/IDL, plus checks that required instructions/events exist.
- Backend↔Chain contract: integration tests on local chain calling real programs.

4) Stateful cross-action testing (the missing piece)
Problem: hand-written E2E tests miss edge-case sequences (supply→borrow→repay→switch wallet→prove ownership...).

Solution:
- Model the product as a state machine:
  - state = {wallet, positions, pendingTx, notes, balances}
  - actions = supply, borrow, repay, withdraw, switchWallet, exportNote, importNote, proveOwnership, refresh
- Generate action sequences automatically (property-based / model-based tests).
- After each action, assert invariants:
  - UI balances match on-chain (within expected eventual consistency window)
  - no negative balances
  - after wallet switch, caches reset and state reflects the new wallet
  - proofs correspond to the currently selected wallet and note set
- When a failure occurs:
  - keep the minimized failing sequence as a regression test
  - attach logs/txids/playwright trace

5) Observability requirements for tests
- Capture:
  - RPC logs + tx signatures
  - server logs (structured)
  - Playwright traces on failure
- Make failures easy to reproduce locally with 1 command.

6) Acceptance test format
Use PRD.json acceptance_tests with deterministic steps and a clear pass condition.
Flip `passes=true` only with evidence recorded in Progress.txt.

