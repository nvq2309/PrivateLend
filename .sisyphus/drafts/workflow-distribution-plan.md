# Draft: Workflow Distribution Plan

## Requirements (confirmed)
- Need a precise workflow distribution plan aligning with WorkGraph/PRD/Test Plan constraints.
- Must include task ownership, allowed_paths, verification commands, and note pending refactor task if warranted.
- Include UI test command equivalence note: `npm run test:ui` == `playwright test` (no extra flags).
- Account for pending tasks WG-042 (UI smoke/E2E) and WG-050 (Docs/runbook), each locked to one working_on at a time.
- Consider AT-HARNESS-003 still failing; plan should reflect harness issues.
- Follow Conversation_Policy (3+ A/B/C/D questions before edits) and ask about WorkGraph visualization choice.

## Technical Decisions
- WorkGraph lock rule: only one task may be `working_on` simultaneously; plan must reflect sequencing/ownership.
- Allowed paths:
  - WG-042: `src/`, `tests/ui/`, `.agent-workflow/Test_Plan.md`
  - WG-050: `README.md`, `RUNBOOK.md`, `.agent-workflow/`
- Evidence gate: include verification commands producing evidence for acceptance tests.
- Clarify Gate: ensure questions capture ambiguous inputs (operator note "1A>>B 2B 3AC", test command meaning).

## Research Findings
- Operator uses `npm run test:ui`; package.json script `test:ui` maps to `playwright test` (no extra flags).
- PRD preset currently `backend-dev` in `PRD.json` (impacts priority/acceptance focus).
- AT-HARNESS-003 failure indicates harness instability affecting acceptance verification.

## Open Questions
- Need owner mapping for letters A/B/C within "1A>>B 2B 3AC" so plan can assign responsibilities.

## Scope Boundaries
- INCLUDE: Workflow distribution plan covering WG-042, WG-050, gating requirements, verification commands, clarifications.
- EXCLUDE: Implementing code, editing files beyond planning artifacts, executing tests.

## Test Strategy Decision
- Infrastructure exists: Playwright UI tests (`npm run test:ui`).
- Operator confirmed `npm run test:ui` should be documented as a `playwright test` alias plus mention that flags can be added when required.
- Need to document how failing AT-HARNESS-003 impacts verification steps and whether remediation runs alongside other tasks or acts as a blocker depending on file overlap.

## Additional Notes
- Shorthand "1A>>B 2B 3AC" map established: 1 → WG-042 (UI smoke), 2 → WG-050 (Docs/runbook), 3 → pending docs refactor placeholder once prior tasks are fully verified; letters denote owners TBD.
- Visualization preference: provide a matrix-style dependency/ownership table inside the plan.
- Refactor placeholder should target docs/runbook structure and only activate once WG-042 + WG-050 complete with evidence.
- AT-HARNESS-003 fix is isolated from WG-042/WG-050 allowed paths, so stabilization work can run in parallel provided we respect the single `working_on` lock.
