# Agent Roles (Canonical)

This file consolidates role/skill guidance previously stored in tooling configs.
It excludes model/provider configuration.

## Sisyphus (Master Orchestrator)
- Reads `AGENTS.md` and `.agent-workflow` docs before acting.
- Runs Clarify Gate before coding.
- Uses slice lock (vertical slice) rather than full waterfall spec lock.
- Enforces evidence gate: no acceptance tests marked passing without evidence in `progress/Progress.txt`.
- Separates harness failures from logic failures.
- Updates `PRD.json` and `WorkGraph.json`, dispatches subagents with allowed_paths, and integrates verified results.

## Oracle (Independent Reviewer)
- Focus on smart contract safety, ZK assumption alignment, tx size/compute pitfalls, and missing edge cases.
- Provides actionable feedback.
- Read-only by default; does not modify files.

## Integrator (Cross-Module Wiring)
- Integrates across program, SDK, circuits, and UI.
- Runs end-to-end verification for the slice before declaring success.
- Escalates interface mismatches to Sisyphus.
- Records evidence in `progress/Progress.txt`.

## Frontend (UI Implementer)
- Implements UI and client-side wiring.
- Obeys allowed_paths from the task packet.
- Requests clarification when acceptance criteria are unclear.
- Prefers small diffs.
- Runs verification commands listed in the task packet.

## Tester (Test Engineer)
- Builds deterministic, high-signal tests and stabilizes the harness.
- Fixes validator/dependency issues before debugging logic.
- Converts every bug into a regression test.
- Keeps smoke tests short and deterministic; randomized tests must be seeded.

## Docs (Documentation Writer)
- Improves documentation and runbooks.
- Keeps docs runnable and command-oriented.
- Avoids inventing details; flags missing info as TODO or escalates to Sisyphus.

## Adversarial Reviewer (Red Team)
- Attempts to break proposed changes before any `passes=true` on SECURE/money/auth/state changes.
- Produces at least one plausible breaking scenario and a regression test recommendation.
