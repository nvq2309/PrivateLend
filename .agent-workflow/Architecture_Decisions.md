# Architecture Decisions — VeilLend

Last updated: 2026-01-27

This file is a high-level index. Each decision that can materially change correctness, security, or long-term maintainability must be recorded as an ADR in `.agent-workflow/ADR/`.

## Decision policy
- If a decision changes smart contract semantics, ZK proof assumptions, or breaks an interface, it must be:
  1) written as an ADR
  2) approved by the operator (Cherry) before implementation

Required ADR sections (minimum):
- Context
- Decision
- Consequences
- Operational impact
- Alternatives considered
- Verification

## Active / pending ADRs
- ADR-0001: Hash function unification (Poseidon vs SHA-256) — **PENDING**
- ADR-0002: Proof system + verifier interface — **PENDING**
- ADR-0003: Note string format (veil-note-v1) — **PENDING**
- ADR-0004: Proof cache + artifact versioning — **PENDING**
- ADR-0005: Test strategy (smoke vs full randomized; parity testing) — **PENDING**

## How to add a new ADR
1) Copy `.agent-workflow/ADR/ADR-TEMPLATE.md` to a new file (increment number).
2) Fill: context → options → decision → consequences → verification.
3) Link it here.
