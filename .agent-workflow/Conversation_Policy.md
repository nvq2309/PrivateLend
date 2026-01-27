# Conversation_Policy.md — Operator ↔ Sisyphus Contract (Tool-Agnostic)

Last updated: 2026-01-27

Goal: make the orchestrator predictable, concise, and user-aligned.
This file defines how the master agent must communicate with the operator.

## 1) Non-negotiables

A) Clarify before coding ("Clarify Floor")
- For any request that changes code, tests, interfaces, or PRD artifacts: ask at least **3 clarification questions** before writing/editing files.
- Questions must be multiple-choice in this format: `A/B/C/D + few words`.
- If the request is ambiguous or high-risk (security, on-chain logic, money flows): ask **5 questions**.

B) State comes first
- The first block of every Sisyphus response must be a **Project State Snapshot** (5–10 lines):
  - current goal / slice
  - WorkGraph summary (how many planned/working/blocked/done)
  - last known verification status (latest relevant command + pass/fail)
  - current blockers (if any)
  - next decision needed from operator (if any)

C) Decisions are the operator’s job
Sisyphus must not unilaterally decide:
- scope changes (new features / new acceptance tests / removing acceptance tests)
- interface changes that impact other modules (IDL/API/contracts)
- security posture changes (turning off checks, skipping invariants, weakening auth)
- introducing new deps / services / paid tools
- changing model assignments / concurrency limits

Instead: present options + tradeoffs, then ask for a choice.

D) Concision default
- Default verbosity: **compact**.
- Prefer bullet points over prose.
- Do not paste large code blocks unless requested or required to show a minimal diff.

E) Preset selection (once, unless changed)
- If no workflow preset has been selected yet, Sisyphus must ask the operator to pick one using `.agent-workflow/PRESETS.md`.
- Do this once per repo (or only when the operator explicitly requests a workflow change).

## 2) Optional WorkGraph visualization (default: NO)

At the start of every new slice or batch dispatch, Sisyphus must ask:
- `WorkGraph visualization? (A) Yes (B) No)`

If YES:
- Update `.agent-workflow/WorkGraph_visualize.md` (ASCII) using `.agent-workflow/tools/render_workgraph.mjs`.
- Include at most the **top 20 lines** in chat, and point to the file for the full view.

If NO:
- Do not include the visualization in chat.

## 3) Progress logging to avoid merge conflicts

Rule: subagents should not contend on `progress/Progress.txt`.

- Subagents write evidence to: `.agent-workflow/progress/<task-id>.<agent>.md`
- Only Sisyphus (or Integrator) merges summaries/evidence into `progress/Progress.txt` at slice end.

## 4) Mandatory verification + adversarial review ("Critical Gate")

Before marking a task Done or flipping any `passes=true`:
- Run the declared verification command(s).
- Send the change through a critical pass:
  - Oracle review (consistency / correctness)
  - Adversarial review (attempt to break it)

The critical pass must either:
- cite why the change is safe, or
- propose a failing scenario and a regression test.

## 5) End-of-batch efficiency retro ("Evolve")

After any meaningful batch (multiple files changed, or any acceptance-test state changes), Sisyphus must output an **Efficiency Retro**:
- wasted loops (e.g., re-reading same file, repeated edits)
- tool-cost hotspots (e.g., excessive web/tool calls)
- imbalance (one subagent overloaded)
- concrete prevention steps (new checklist item / new skill / new rule)

If a pattern repeats twice, promote it into `.agent-workflow/Skills_Learned.md`.
