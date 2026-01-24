# AGENTS.md — Operating Rules for Humans + AI Agents
Last updated: 2026-01-23

This file is the single source of truth for **how work is done** in this repository.
It is intentionally explicit because AI agents need stable constraints.

1) Mission
Build the product described in `Product_Description.md` / `Product_Description.txt` and formalized in `PRD.md` and `PRD.json`.
Primary goal: ship a correct, testable, demoable system with minimal human ad-hoc QA.

2) Canonical artifacts
- `Product_Description.md` (or `.txt`): problem + scope + user journeys + acceptance criteria (human-owned).
- `PRD.md`: full product requirements + UX flows + non-goals + constraints.
- `PRD.json`: structured plan, todo list, acceptance tests, assumptions (machine-readable).
- `Progress.txt`: append-only execution log with commands run + outcomes + learnings + next steps.
- Optional but recommended:
  - `WorkGraph.json`: task dependency graph used for multi-agent parallel execution.
  - `Risk_Register.md`: top risks and “early tests” to de-risk quickly.
  - `ADR/`: architecture decision records for key tradeoffs.

3) Non-negotiable workflow rules (apply to all agents)
A. Always start by reading:
   - this file (`AGENTS.md`)
   - `PRD.md` (if exists)
   - `PRD.json` (if exists)
   - `Progress.txt` (if exists)
B. Never work “in the dark”:
   - before implementing, identify the verification command(s) you will run
   - after implementing, run the verification command(s) and record results in `Progress.txt`
C. Keep changes small and reviewable:
   - prefer small PR-sized diffs and short feedback loops
D. Every P0 requirement must have at least one acceptance test in `PRD.json`.
E. Acceptance tests may be marked `passes=true` only with evidence (command output, screenshot, trace, or reproducible steps) recorded in `Progress.txt`.

4) Parallelism protocol (how we safely do multi-agent work)
Goal: maximize throughput without merge conflicts or integration surprises.

A. Work is organized as a dependency graph (“WorkGraph”)
- The master agent maintains `WorkGraph.json` (or the `todo` + `implementation_plan` in `PRD.json` if WorkGraph is absent).
- Each task has:
  - a stable interface contract (API/ABI/IDL/types)
  - a file ownership boundary (allowed directories)
  - a verification plan (tests/commands)
  - explicit dependencies

B. File ownership (“task boundaries”)
Each task must declare **allowed paths**. Subagents may only edit allowed paths, except:
- adding narrow plumbing required by the task (e.g., registering a route in a central router), but keep that change minimal and obvious.

C. Interface-first to enable parallel build
Before multiple agents code in parallel, the master agent must ensure that interface surfaces are frozen:
- UI↔Backend: OpenAPI or typed client contract (request/response + error shapes)
- UI↔Chain: ABI/IDL/contract addresses + event schema
- Backend↔Chain: program calls + indexing strategy
If interfaces are not frozen, parallelism produces rework.

D. Integration is a dedicated task
Integration is not “everyone’s job”. It is a specific task owned by an Integrator agent:
- merges stubs into real implementations
- runs end-to-end harness
- resolves cache/state invalidation issues
- converts discovered bugs into new regression tests

5) Testing protocol (stop doing ad-hoc QA every 5 minutes)
Testing strategy is layered:
- Unit tests: pure logic and data transforms
- Integration tests: module↔module boundaries (API contracts, chain calls on localnet)
- Stateful/system tests: cross-action sequences (supply→borrow→repay→switch wallet…)
- Minimal UI E2E: only critical paths + smoke coverage

For Web3 apps, “passed unit tests” is not enough. You must include:
- Smart contract fuzz/invariant tests (Foundry/Anchor/Rust proptests)
- Contract tests for API shape stability (Pact or equivalent)
- A deterministic local test harness (seeded wallets + bootstrap script)
- A state-machine test suite that generates action sequences and checks invariants

6) Required evidence format (Progress.txt)
Whenever you claim something works, record:
- Commands run
- Outcome (pass/fail)
- What changed (files)
- Which acceptance tests were flipped to passes=true (IDs)
- Any learnings / gotchas
(See `Progress_template.txt` for the canonical structure.)

7) Definition of Done (project-level)
Minimum bar:
- All P0 acceptance tests pass with evidence
- README and/or RUNBOOK explains: setup, run, test, demo
- Known limitations documented
- Security notes for Web3 (threat model, key management assumptions, non-goals)

8) Tooling expectations (opencode + oh-my-opencode)
This repo assumes you may have access to:
- Playwright (for deterministic UI automation)
- Chrome DevTools automation for debugging
- Context7 (library/docs retrieval)
- gh_grep (searching code examples)
See your `opencode.json` for enabled MCP tools.

9) Output format for agents
Agents must be explicit and brief:
- What you will do
- What you changed
- How you verified
- What remains
- What you need from the human (only if blocking)

