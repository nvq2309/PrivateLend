# AGENTS.md — VeilLend Workflow (Repo Root)
Last updated: 2026-01-27

## Current Project Status (ZK Rewrite)
- Scope: ZK-first privacy notes with Merkle commitments and note string UX.
- Circuits: `circuits/veillend` (Poseidon + Merkle proof + LTV=70%).
- Acceptance tests are tracked in `.agent-workflow/PRD.json` with evidence in `.agent-workflow/progress/Progress.txt`.

## Required reading order
1) `.agent-workflow/Conversation_Policy.md`
2) `.agent-workflow/Product_Description.md`
3) `.agent-workflow/PRD.md` and `.agent-workflow/PRD.json`
4) `.agent-workflow/WorkGraph.json` and `.agent-workflow/Test_Plan.md`
5) `.agent-workflow/Risk_Register.md` and `.agent-workflow/Architecture_Decisions.md`
6) `.agent-workflow/progress/Progress.txt` (recent entries)
7) `.agent-workflow/Skills_Learned.md`

## Mission
Ship correct, demoable VeilLend slices with strong verification discipline.
Assume high risk: on-chain state + money flows + crypto/ZK surfaces.

## Non-negotiable rules
1) Clarify Gate before coding
- Ask 3+ A/B/C/D questions before edits (success, scope, verification).
- No silent assumptions on money flows / SECURE instructions.

2) Evidence Gate
- Never mark `acceptance_tests[].passes=true` without evidence (commands + outputs).

3) Critical Gate (Oracle/Adversarial)
- Before any `passes=true` on SECURE / money / auth / state changes:
  - run verification
  - run oracle/adversarial review

4) Failure triage (A/B/C)
When tests fail, classify first:
A) Harness (validator/deps/flags)
B) Logic bug (program/SDK)
C) Spec mismatch (acceptance unclear)

Do not loop on B if A or C is still plausible.

## Parallelism protocol
- Work is coordinated via WorkGraph tasks with `allowed_paths`.
- Only one agent can own a `working_on` task (lock).
- Use `.agent-workflow/Workflow_Isolation.md` for parallel workflows.

## Solana/Anchor harness notes
- `pkill -f solana-test-validator || true`
- `pkill -f solana-faucet || true`
- Prefer targeted grep runs for tight loops.

## Testing protocol
- Unit tests for pure logic
- Integration tests for boundary contracts (SDK ↔ program)
- Scenario/state-machine tests for cross-action flows
- Negative tests for signer/account constraints and invalid proofs

## Definition of done (project-level minimum)
- All P0 acceptance tests pass with evidence
- Setup/run/test instructions exist (README/RUNBOOK)
- Known limitations documented
- Security notes documented (threat model, key management, double-spend prevention)

## Knowledge base (quick reminders)
- **Tx size**: derive values from PDAs/accounts instead of passing redundant args.
- **Compute budget**: add `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` for ZK verification txs.
- **Hasher**: use Poseidon consistently across client/circuit/on-chain.
