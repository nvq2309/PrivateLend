# Workflow Presets (Optional)

Purpose: avoid “one size fits all”. Pick a preset once per repo (or when you explicitly change it).

How it works:
- Operator picks a preset.
- Sisyphus configures/uses the corresponding agent roster + verification profile.

## Preset 1 — System Design / Research-Heavy
Use when:
- you are designing an architecture, protocols, or product system
- minimal code changes, maximum reading/research

Agent roster:
- Sisyphus (orchestrator)
- Librarian (docs crawler / large context)
- Architect (ADR writer)
- Critic (risk + trade-offs)
Verification profile:
- ADRs + interface contracts + threat model, light tests

## Preset 2 — Web3 Protocol / Smart Contracts (High Risk)
Use when:
- on-chain logic, money flows, ZK verifiers, tokenomics-critical code

Agent roster:
- Sisyphus
- Implementer
- Tester (state-machine + invariants)
- Oracle (independent verify)
- Antigravity (adversarial break)
Verification profile:
- invariants + negative tests + diff/parity tests
- security checklist gate

## Preset 3 — Backend Product Feature
Use when:
- APIs, databases, auth, services

Agent roster:
- Sisyphus
- Implementer
- Tester
- Oracle
Verification profile:
- contract tests + unit tests + minimal E2E

## Preset 4 — Frontend / UX
Use when:
- UI components, UX polish, Figma→code

Agent roster:
- Sisyphus
- Frontend implementer
- Tester (Playwright / UI smoke)
- Oracle
Verification profile:
- visual regression (optional) + E2E happy paths

## Preset selection questions (A/B/C/D)
1) Primary deliverable:
   A) Architecture/spec  B) On-chain logic  C) Backend feature  D) Frontend UX
2) Risk tolerance:
   A) Low (security-first)  B) Medium  C) High  D) Experimental
3) Test investment:
   A) Minimal  B) Normal  C) High  D) Extreme (fuzz/invariants)
