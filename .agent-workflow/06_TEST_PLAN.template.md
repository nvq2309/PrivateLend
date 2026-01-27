# Test Plan (Template)

Goal: eliminate ad-hoc QA by defining deterministic verification layers.

## 1) Verification layers

1) Unit tests
- Pure logic, no network, deterministic.

2) Contract/interface tests
- API shapes, type compatibility, schema validation.

3) Integration tests
- Module ↔ module boundaries.
- Use local containers/sandboxes where possible.

4) System / scenario tests
- Cross-action sequences, state-machine coverage.

5) E2E UI smoke tests (optional)
- Only critical paths.

## 2) Slice-based testing rule

For early slices:
- It is acceptable to start with interface mocks and minimal tests,
  BUT you must create the test harness early so hardening is incremental.

Rule of thumb:
- Slice S01: harness + 1–2 “happy path” acceptance tests
- Slice S02+: add edge cases, negative cases, invariants, fuzzing (domain-dependent)

## 3) Domain add-ons (use if applicable)

### Web3 / smart contracts
- Include fuzz/invariant testing (Foundry / Echidna / proptests) once logic is real.
- Treat “unit tests pass” as insufficient for security.

### Fintech / payments
- Threat model: auth, authorization, replay, idempotency, ledger consistency.
- Add regression tests for every incident.

### AI features
- Add deterministic eval harness where possible (golden datasets, snapshot tests).
- Log prompts/outputs safely (avoid secrets).

## 4) Command inventory (fill in)

- lint:
- unit:
- integration:
- e2e:
- full verify (preferred):
