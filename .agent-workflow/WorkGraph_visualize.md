# WorkGraph_visualize.md (auto-generated)

Generated: 2026-01-27T05:56:30.528Z
Project: VeilLend

Legend: [P]=planned [W]=working [B]=blocked [D]=done [X]=cancelled [?]=unknown

Status counts: completed:10 | planned:2

```text
ID       S  Agent        Title                                                        Deps                
----------------------------------------------------------------------------------------------------------
WG-042   P  frontend     UI smoke/E2E tests for critical secure paths                 WG-040              
WG-050   P  docs         Docs + demo runbook (localnet and devnet)                    WG-041,WG-042       
WG-001   D  tester       Harness preflight: validator lifecycle + deterministic boot…                     
WG-002   D  tester       Fix/standardize test runner invocation (grep passthrough, d… WG-001              
WG-010   D  implementer_ Implement note string encode/decode contract (veil-note-v1)  WG-002              
WG-011   D  tester       Commitment alignment test (client ↔ circuit ↔ on-chain assu… WG-010              
WG-020   D  implementer_ Proof generation pipeline (local/dev): witness → proof       WG-011              
WG-021   D  implementer_ Proof cache and artifact versioning                          WG-020              
WG-030   D  implementer_ On-chain verification for secure_supply (narrow slice)       WG-020              
WG-031   D  integrator   Compute + tx-size budget hygiene for SECURE instructions     WG-030              
WG-040   D  integrator   Full SECURE loop: borrow/repay/withdraw with note-in/note-o… WG-031              
WG-041   D  tester       Parity tests: FAST vs SECURE invariants                      WG-040              
```

Notes:
- Edit `.agent-workflow/WorkGraph.json` (source of truth).
- Re-render with: `node .agent-workflow/tools/render_workgraph.mjs`