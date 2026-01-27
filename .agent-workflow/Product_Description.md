# Product Description — VeilLend (ZK Rewrite Phase)

## One‑liner
VeilLend is a Solana lending broker that supports a “secure mode” where user actions can be proven valid (e.g., LTV constraints) without revealing private position details.

## Problem
Traditional DeFi lending exposes:
- how much a user supplied/borrowed/withdrew
- when they performed actions
- their position evolution over time

For the target use case (Web3 + fintech workflows), this is unacceptable for many users and teams.

## Target users
- Early adopters and power users who want private lending interactions on Solana.
- Operators who want a demoable secure flow (small audience; <100 CCU).

## Product goals (P0)
P0 goals describe what must exist for a first serious demo:

1. Secure “note-based” flow exists end-to-end on localnet:
   - Supply → receive a note string
   - Borrow using a note → receive an updated note string
   - Repay using a note → receive an updated note string
   - Withdraw using a note → receive an updated note string

2. On-chain program enforces solvency constraints (LTV) for both:
   - FAST mode (non-private baseline)
   - SECURE mode (proof-gated)

3. Deterministic verification:
   - Each P0 has acceptance tests in `PRD.json`
   - Tests can be reproduced via seeded runs and documented commands
- No acceptance test is marked passing without evidence recorded in `progress/Progress.txt`

## Non-goals (for this phase)
- Interest rates / interest accrual
- Liquidations and keeper bots
- Multi-asset collateral/oracles
- Cross-chain bridging
- Production-grade key custody UX

## Constraints
- LTV is fixed at 70% for initial implementation (this is the security invariant we optimize around).
- The workflow must be agent-friendly:
  - explicit file ownership boundaries
  - small diffs
  - deterministic verification commands
- Cost/quality preference: bias toward cost-efficient iteration for most work, but use high-quality review for smart contract correctness and ZK/security decisions.

## System overview (conceptual)
Two modes exist:

A) FAST mode (baseline)
- Standard lending: supply/borrow/repay/withdraw with transparent amounts.

B) SECURE mode (privacy)
- The user holds a note string locally.
- The user generates a ZK proof that the requested action is valid under protocol rules.
- The program verifies the proof and updates the state (e.g., nullifier set and Merkle root).
- The program emits/returns enough info for the client to construct the next note.

## What “done” means (Definition of Done)
A feature is “done” only if:
- It has acceptance tests in `PRD.json`
- The tests pass locally with a deterministic command
- Evidence is recorded in `progress/Progress.txt`
- Any discovered bug is turned into a regression test

## Demo script (MVP)
1) Start localnet + bootstrap
2) Run secure supply → receive a note string
3) Run secure borrow with note → receive updated note string
4) Run secure repay with note
5) Run secure withdraw with note
6) Verify: localnet program state updated correctly (LTV maintained) and proofs verified
