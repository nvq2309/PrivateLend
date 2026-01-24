# Architecture Decisions (ZK Rewrite)

## ADR-001: Note commitment hash function
- Decision: Poseidon for commitments + Merkle tree.
- Rationale: standard for Circom circuits; cheaper in proof systems.

## ADR-002: Note format
- Decision: ASCII string `veil-note-v1:<hex>`.
- Rationale: portable, user-friendly, Tornado-style.

## ADR-003: LTV in circuit
- Decision: enforce LTV in circuits (70%).
- Rationale: prevents borrow beyond allowed exposure without revealing balances.
