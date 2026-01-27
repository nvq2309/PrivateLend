# Progress.d — Per-Task Evidence Logs

Goal: avoid merge conflicts and make multi-agent work observable.

Convention:
- Each task writes to its own file:
  - `.agent-workflow/progress/<task-id>.<agent>.md`
  - Example: `.agent-workflow/progress/WG-012.tester.md`

Rules:
- Subagents do **not** edit `progress/Progress.txt` directly.
- Sisyphus (or Integrator) periodically merges key evidence into `progress/Progress.txt`.

Minimal evidence block (copy/paste):

```text
# <task-id> — <short title>
Owner: <agent>
Date: <YYYY-MM-DD>

Commands run:
- <cmd>

Outcome:
- PASS/FAIL

Notes:
- <1-5 bullets>
```
