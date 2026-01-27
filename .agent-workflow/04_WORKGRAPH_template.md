# WorkGraph (Template)

WorkGraph.json is a lightweight task graph so multiple agents can work safely.

Rules:
- A task in `working` is locked.
- Each task declares `allowed_paths` (file ownership).
- Each task declares verification commands.

Recommended statuses:
- `todo` → `ready` → `working` → `review` → `done` → `blocked`

## Minimal schema (example)

```json
{
  "tasks": [
    {
      "id": "WG01",
      "title": "Define interfaces for Slice S01",
      "owner_agent": "prometheus",
      "status": "ready",
      "depends_on": [],
      "allowed_paths": ["src/types/**", "docs/**"],
      "verification": ["npm test"],
      "notes": ""
    }
  ]
}
```
