# AI-First Software Engineering Framework (Web3-Optimized) — v1

Last updated: 2026-01-23

This bundle is a practical framework for building software (especially Web3 apps) efficiently with single- or multi-agent AI setups (e.g., opencode + oh-my-opencode).

The core idea: **spec-first + interface-first + task packets + evidence-based verification**.

Folder contents

- `AGENTS.md` — the single source of truth for agent rules, conventions, and workflow (merge of your `instruction.txt` + typical AGENTS.md patterns).
- `00_APPLY_THIS_FRAMEWORK.md` — the “how to use” playbook.
- `01_Product_Description.template.md` — template for your Step 1 artifact (what you write).
- `02_PRD.template.md` — template for PRD.md (what agents produce and refine).
- `03_PRD.json.template.json` — compatible with your current PRD.json shape; adds guidance without breaking the schema.
- `04_WORKGRAPH.template.json` — a dependency graph used by the master agent to parallelize.
- `05_TASK_PACKET.template.md` — task packet format for subagents (enables safe parallelism).
- `06_TEST_PLAN.template.md` — testing strategy with Web3 integration + state-machine coverage.
- `07_RISK_REGISTER.template.md` — risk register template (de-risking is the speed multiplier).
- `08_ARCHITECTURE_DECISIONS.template.md` — ADR template (small, cheap documentation that prevents rework).
- `09_MASTER_AGENT_PROMPT_SISYPHUS.md` — drop-in prompt for your orchestrator/master agent.
- `10_SUBAGENT_PROMPT_IMPLEMENTER.md` — drop-in prompt for coding subagents.
- `11_SUBAGENT_PROMPT_TEST_ENGINEER.md` — drop-in prompt for test-focused subagents.
- `12_SUBAGENT_PROMPT_INTEGRATOR.md` — drop-in prompt for cross-module integration.
- `examples/` — filled examples showing what “good” looks like.

Notes

- This framework assumes you maintain: PRD.md, PRD.json, Progress.txt, and optionally WorkGraph.json.
- It is designed to minimize human “ad-hoc QA” by shifting verification into:
  1. deterministic harnesses (local chain + seeded accounts),
  2. contract tests at boundaries,
  3. state-machine/property-based tests for cross-action sequences,
  4. Playwright traces for fast debugging.
