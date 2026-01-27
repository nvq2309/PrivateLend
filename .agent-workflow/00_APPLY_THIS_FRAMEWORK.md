# 00 — Apply This Framework (Agentic SDLC, Non‑Waterfall)

This framework replaces “plan everything perfectly, then build” with a controlled, verification-driven loop that works with AI agents.

Core principles
1) Clarify Gate before coding  
No slice starts until success / out-of-scope / failure modes / verification evidence are explicit (or assumptions are recorded).

2) Slice Lock, not Spec Lock  
Only lock the minimum interfaces needed for the next vertical slice.

3) Evidence Gate  
No claims of completion without commands/logs recorded in `.agent-workflow/progress/Progress.txt` (or per-task logs merged into it).

4) Controlled parallelism  
Run 2–3 concurrent tasks max, with explicit file ownership (`allowed_paths`) and WorkGraph locks.

5) Critical Gate for risky changes  
Before marking `passes=true` on stateful/security-sensitive work, run an adversarial review (oracle / red team).

6) Evolve the workflow  
After each milestone, run a retrospective and turn inefficiencies into reusable “skills”.

Operating loop (repeat per slice)
A) Pick the next slice  
- Choose a single user-visible outcome or a risk-reduction outcome.
- Update `.agent-workflow/PRD.json` with slice acceptance tests + assumptions.

B) Clarify Gate  
- Sisyphus asks 3+ A/B/C/D questions (success, scope, verification).
- If ambiguous: present options + trade-offs; wait for operator choice.

C) Interface & skeleton (fast)  
- Define types/contracts/interfaces first.
- Add stubs/mocks to enable parallel work.

D) Dispatch (parallel where safe)  
- Implementer: code in allowed paths
- Tester: harness + acceptance tests + integration tests
- Oracle: adversarial review for risky changes
- Integrator: cross-module wiring + end-to-end verify

E) Verify + evidence  
- Run the task’s verification command(s).
- Subagents log evidence to `.agent-workflow/progress/<task-id>.<agent>.md`.
- Sisyphus merges essential evidence into `.agent-workflow/progress/Progress.txt`.

F) Retrospective  
- After milestone: update `Efficiency_Log.md`, `Retrospective_Log.md`, and (if needed) `Skills_Learned.md`.

Key files to keep current
- `Product_Description.md` : scope, target users, success metrics
- `PRD.md` + `PRD.json` : requirements, acceptance tests, assumptions
- `WorkGraph.json` : task graph and locks (optional but recommended)
- `Test_Plan.md` : verification inventory and layers
- `progress/Progress.txt` : append-only evidence log (merged from per-task logs)
- `Conversation_Policy.md` : operator ↔ orchestrator contract
- `PRESETS.md` : one-time workflow selection
