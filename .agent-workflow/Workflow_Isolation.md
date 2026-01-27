# Workflow Isolation Protocol

Use folder-based isolation when running parallel workflows (frontend + backend) to avoid progress/Progress.txt contention.

## Directory Structure
```
.agent-workflow/
├── workflows/
│   ├── {workflow-id}/
│   │   ├── Progress.txt
│   │   ├── WorkGraph.json (optional)
│   │   └── context.md
├── progress/
│   ├── Progress.txt
├── WorkGraph.json
└── ...
```

## Workflow Lifecycle
1) Create workflow folder:
```
mkdir -p .agent-workflow/workflows/wf-{name}
```

2) Work within workflow:
- Log to `workflows/{id}/Progress.txt` (not main log).
- Stay within declared `allowed_paths`.
- One agent owns a workflow at a time.

3) Merge workflow:
- Append to main `.agent-workflow/progress/Progress.txt` and archive the workflow folder.

## Naming Convention
- `wf-frontend-` (UI)
- `wf-backend-` (contracts/SDK)
- `wf-infra-` (tooling)
- `wf-research-` (spike)
- `wf-hotfix-` (urgent fix)
