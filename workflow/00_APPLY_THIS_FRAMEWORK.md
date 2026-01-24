# How to apply this framework (the short playbook)
Last updated: 2026-01-23

You own the product definition. Agents own planning + implementation + verification, under strict rules.

Phase 0 — Repository initialization (one-time per repo)
1. Add this framework folder (or copy the files into repo root).
2. Ensure `AGENTS.md` exists at repo root.
3. Ensure you have:
   - `Product_Description.md` (or `.txt`)
   - `PRD.md` (agents can generate)
   - `PRD.json` (agents can generate)
   - `Progress.txt` (agents must append to)

Phase 1 — You write Product_Description
- Use `01_Product_Description.template.md`.
- The output should be a crisp “scope contract”.
- This becomes the input to the master agent.

Phase 2 — Master agent produces PRD.md + PRD.json + Risk register
Master agent responsibilities:
- Convert Product_Description into:
  - PRD.md (narrative spec)
  - PRD.json (structured plan + tests + assumptions)
  - Risk_Register.md (top risks + early tests)
- Produce (or update) WorkGraph.json to enable parallelization.

Human gate:
- You approve only 3 things:
  1) scope (goals/non-goals),
  2) success metrics,
  3) top risks / constraints.

Phase 3 — Parallel build using Task Packets
1. Master agent creates tasks as a DAG:
   - interface-first tasks (contracts/types)
   - scaffolding tasks (repo skeleton, CI)
   - vertical slice (one end-to-end “golden path”)
   - feature expansions
2. For each task, master agent produces a `Task Packet` and dispatches to subagents.
3. Subagents implement strictly within allowed paths and return:
   - patch/diff
   - tests added/updated
   - verification evidence

Phase 4 — Integration + hardening
- Integrator agent owns:
  - connecting UI↔BE↔Chain
  - state invalidation correctness
  - regressions turned into tests
- QA Reviewer agent owns:
  - acceptance test evidence
  - threat model sanity
  - “Definition of Done” checks

Phase 5 — Release readiness
- Produce a runbook and demo script.
- Ensure all P0 tests are passing and recorded.

Practical advice
- If a bug is found manually: it is not “fixed” until it becomes a deterministic regression test.
- Favor early vertical slice over building each layer to completion independently.
- Freeze contracts early; implementation can change later with less pain.

