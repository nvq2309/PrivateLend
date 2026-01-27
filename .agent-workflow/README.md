# AI-First Software Engineering Framework — v1 (Enhanced)

Last updated: 2026-01-27

This bundle is a practical framework for building software (any domain) efficiently with single- or multi-agent AI setups.

Core idea: **slice-first (not waterfall) + interface-first + task packets + evidence-based verification + zero-interruption execution**.

## Folder contents (canonical)

- `AGENTS.md` — single source of truth for agent rules, conventions, and workflow.
- `Conversation_Policy.md` — operator ↔ orchestrator contract.
- `Agent_Roles.md` — role/skill guidance for agents (no model config).
- `Workflow_Isolation.md` — parallel workflow protocol.
- `Skills_Learned.md` — workflow skills and anti-patterns.
- `Efficiency_Log.md`, `Retrospective_Log.md` — workflow evolution logs.
- `Product_Description.md` — scope contract (human-owned).
- `PRD.md` — narrative spec for the project.
- `PRD.json` — structured plan + acceptance tests.
- `WorkGraph.json` — dependency graph for parallel execution.
- `Test_Plan.md` — verification strategy and preflight steps.
- `Risk_Register.md` — top risks and early tests.
- `Architecture_Decisions.md` — ADR index and decision policy.
- `progress/Progress.txt` — execution log (append-only).
- `Progress_template.txt` — canonical Progress log template.

## Workflow summary
- Intake → clarify goals and acceptance criteria
- Design → interfaces, risks, and ADRs first
- Build → task graph, file boundaries, parallel agents
- Verification → unit/integration/adversarial checks
- Synthesis → merge evidence, update lessons

## Key rules
- Clarify Gate: 3+ A/B/C/D questions before edits on SECURE/money flows.
- Evidence Gate: no `passes=true` without logged evidence.
- Critical Gate: oracle/adversarial review before SECURE/money/auth/state changes.

## Testing summary
- Unit: pure logic (encoding/decoding, math)
- Integration: module boundaries (UI↔SDK↔chain)
- Stateful/system: cross-action sequences
- UI E2E: minimal smoke + traces on failure

## Notes

- This framework assumes you maintain: PRD.md, PRD.json, progress/Progress.txt, and optionally WorkGraph.json.
- Zero-Interruption Workflow: always preflight file access and tool use before execution.
- Evidence-based verification is mandatory; do not mark tests passing without proof.
- Output rules live in `Conversation_Policy.md`.
- Recommended preset for VeilLend on-chain work: `backend-dev` (see `PRESETS.md`).
