# AGENTS.md — Operating Rules for Humans + AI Agents

Last updated: 2026-01-25

This file is the single source of truth for **how work is done** in this repository.
It is intentionally explicit because AI agents need stable constraints.

## Current Project Status (ZK Rewrite)

- Scope: ZK-first privacy notes with Merkle commitments and note string UX.
- Circuits: implemented in `circuits/veillend` (Poseidon + Merkle proof + LTV=70%).
- Tests: SECURE acceptance tests are reset to `passes=false` until proof verification is wired end-to-end.

## Workflow Entry (Required)

Before doing any work, follow the workflow in `.agent-workflow/`:

1. Read `.agent-workflow/Product_Description.md`
2. Read `.agent-workflow/PRD.md` and `.agent-workflow/PRD.json`
3. Read `.agent-workflow/WorkGraph.json` and `.agent-workflow/Test_Plan.md`
4. Use `.agent-workflow/Risk_Register.md` and `.agent-workflow/Architecture_Decisions.md` to guide tradeoffs
5. **CRITICAL**: Read `.agent-workflow/AGENTS.md` before starting any task.

1. Mission
   Build the product described in `.agent-workflow/Product_Description.md` / `.agent-workflow/Product_Description.txt` and formalized in `.agent-workflow/PRD.md` and `.agent-workflow/PRD.json`.
   Primary goal: ship a correct, testable, demoable system with minimal human ad-hoc QA.

2. Canonical artifacts

- `.agent-workflow/Product_Description.md` (or `.txt`): problem + scope + user journeys + acceptance criteria (human-owned).
- `.agent-workflow/PRD.md`: full product requirements + UX flows + non-goals + constraints.
- `.agent-workflow/PRD.json`: structured plan, todo list, acceptance tests, assumptions (machine-readable).
- `Progress.txt`: append-only execution log with commands run + outcomes + learnings + next steps.
- Optional but recommended:
  - `.agent-workflow/WorkGraph.json`: task dependency graph used for multi-agent parallel execution.
  - `.agent-workflow/Risk_Register.md`: top risks and “early tests” to de-risk quickly.
  - `.agent-workflow/ADR/`: architecture decision records for key tradeoffs.

## 4. Non-negotiable workflow rules (apply to all agents)
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

## 5. Parallelism protocol (how we safely do multi-agent work)
Goal: maximize throughput without merge conflicts or integration surprises.

A. Work is organized as a dependency graph (“WorkGraph”)
   - The master agent maintains `WorkGraph.json`.
   - **Collision Avoidance**: Agents must check `WorkGraph.json` for task status before starting. Only one agent should work on a task at a time. Tasks marked "working on" are locked.

B. File ownership (“task boundaries”)
   - Each task must declare **allowed paths**. Subagents may only edit allowed paths.
   - **Strict Boundary Enforcement**: Frontend agents must not touch `programs/`, `circuits/`, or backend tests. Backend agents must not touch `src/components/`, `src/pages/`, or frontend tests.

C. Interface-first to enable parallel build
   - Before multiple agents code in parallel, the master agent must ensure that interface surfaces are frozen.

D. Integration is a dedicated task
   - Integration is not “everyone’s job”. It is a specific task owned by an Integrator agent.
   - **Workflow Synchronization**: Agents must update `Progress.txt` immediately after completing a task or encountering a blocker to keep other agents informed.

## 6. Testing protocol (stop doing ad-hoc QA every 5 minutes)
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

## 7. Required evidence format (Progress.txt)
Whenever you claim something works, record:
- Commands run
- Outcome (pass/fail)
- What changed (files)
- Which acceptance tests were flipped to passes=true (IDs)
- Any learnings / gotchas
See `.agent-workflow/Progress_template.txt` for the canonical structure.

## 8. Definition of Done (project-level)
Minimum bar:
- All P0 acceptance tests pass with evidence
- README and/or RUNBOOK explains: setup, run, test, demo
- Known limitations documented
- Security notes for Web3 (threat model, key management assumptions, non-goals)

## 9. Tooling expectations (opencode + oh-my-opencode)
This repo assumes you may have access to:
- Playwright (for deterministic UI automation)
- Chrome DevTools automation for debugging
- Context7 (library/docs retrieval)
- gh_grep (searching code examples)
See your `opencode.json` for enabled MCP tools.

## 10. Agent Experience & Troubleshooting (Knowledge Base)
This section aggregates lessons learned to prevent recurring issues.

A. Zero-Interruption Workflow (General)
   - **Foresee & Batch**: Before starting, `glob` and `read` all necessary files. Ensure you have access.
   - **Plan vs. Execute**: Separate planning (read-only) from execution (write). Do not stop execution for permissions.
   - **Tooling**: Verify tool requirements before use.

B. Transaction Size & Optimization
   - **Problem**: `Transaction too large` (>1232 bytes) in secure instructions.
   - **Solution**: Do NOT pass redundant arguments (like `note_hash`) if they can be derived from accounts already in the instruction.
   - **Rule**: Optimize instruction data layout before attempting complex solutions like Address Lookup Tables (ALTs).

C. Compute Budget (CU) Limits
   - **Problem**: `ComputeBudgetExceeded` in ZK verification instructions.
   - **Solution**: ALWAYS add `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` to transactions involving `verify_groth16_proof`.
   - **Note**: Use `setComputeUnitLimit`, not the deprecated `requestUnits`.

D. Test Environment Hygiene
   - **Problem**: `solana-test-validator` state persists or hangs.
   - **Solution**: Always chain `pkill -f solana-test-validator || true` before running `anchor test`.
   - **Command**: `pkill -f solana-test-validator || true && anchor build && COPYFILE_DISABLE=1 anchor test`

E. Dependency Management
   - **Rule**: Use `poseidon` for all ZK hashing. Do not introduce `solana-sha256-hasher` or mix hashers unless explicitly required by a new spec.

F. Workflow & Collision Avoidance
   - **Rule**: Respect `WorkGraph.json` locks. If a task is "working on", do not touch it.
   - **Rule**: If you need a change in another agent's domain (e.g., Backend needs Frontend change), request it via `Progress.txt` or a task packet. Do not cross the boundary.
