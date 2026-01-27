# AGENTS.md — VeilLend Workflow Rules (Tool-Agnostic)
Last updated: 2026-01-27

This file defines how work is done for VeilLend (slice-based, evidence-driven, non-waterfall).

## Required reading order
1) `Conversation_Policy.md`
2) `Product_Description.md`
3) `PRD.md` and `PRD.json`
4) `WorkGraph.json` and `Test_Plan.md`
5) `Risk_Register.md` and `Architecture_Decisions.md`
6) `progress/Progress.txt` (recent entries)
7) `Skills_Learned.md`
8) `Workflow_Isolation.md` (if running parallel workflows)

## Mission
Ship correct, demoable VeilLend slices with strong verification discipline.
Assume high risk: on-chain state + money flows + crypto/ZK surfaces.

## Canonical artifacts
- `Product_Description.md`: scope and goals
- `PRD.md` / `PRD.json`: requirements + acceptance tests + assumptions
- `WorkGraph.json`: task dependency graph + collision avoidance
- `progress/Progress.txt`: append-only evidence log (merged)
- `progress/`: per-task evidence logs
- `Test_Plan.md`: verification layers + command inventory
- `ADR/`: architecture decisions
- `PRESETS.md`: workflow preset selection
- `Conversation_Policy.md`: operator ↔ orchestrator contract
- `Agent_Roles.md`: role/skill guidance
- `Skills_Learned.md`, `Efficiency_Log.md`, `Retrospective_Log.md`: workflow evolution loop

## Non-negotiable rules
1) Clarify Gate before coding
- Ask 3+ A/B/C/D questions before edits (success, scope, verification).
- No silent assumptions on money flows / SECURE instructions.

2) Evidence Gate
- Never mark `acceptance_tests[].passes=true` without evidence (commands + outputs).
- Evidence is logged in `progress/` then merged into `progress/Progress.txt`.

3) Critical Gate (Oracle/Adversarial)
- Before any `passes=true` on SECURE / money / auth / state changes:
  - run verification
  - run oracle/adversarial review
  - resolve blocking issues or log explicit risk acceptance

4) Failure triage (A/B/C)
When tests fail, classify first:
A) Harness (validator/deps/flags)
B) Logic bug (program/SDK)
C) Spec mismatch (acceptance unclear)

Do not loop on B if A or C is still plausible.

## Parallelism protocol
- Work is coordinated via WorkGraph tasks with `allowed_paths`.
- Only one agent can own a `working_on` task (lock).
- Use `Workflow_Isolation.md` when running multiple workflows concurrently.
- Integration is a dedicated role; do not “hand-wave” integration.

## Solana/Anchor harness notes
- Kill stale validator processes before targeted test loops:
  - `pkill -f solana-test-validator || true`
  - `pkill -f solana-faucet || true`
- Prefer targeted grep runs for tight loops (when supported).

## Testing protocol
- Unit tests for pure logic
- Integration tests for boundary contracts (SDK ↔ program)
- Scenario/state-machine tests for cross-action flows (supply→borrow→repay→withdraw)
- Negative tests for signer/account constraints and invalid proofs
- Treat “unit tests pass” as insufficient for security; require oracle review on SECURE work

## Definition of done (project-level minimum)
- All P0 acceptance tests pass with evidence
- Setup/run/test instructions exist (README/RUNBOOK)
- Known limitations documented
- Security notes documented (threat model, key management, double-spend prevention)
- Oracle review logged for all SECURE/security-sensitive changes
