# Task Packet - Backend Workflow

Task ID: WG-BACKEND
Owner agent: Protocol & ZK Engineer
Type: smart-contract
Priority: P0
Depends on: [specs-frozen]

Objective
- Implement complete ZK-first lending protocol with Merkle commitments, nullifiers, and Groth16 proof verification
- Ensure all secure instructions (deposit, borrow, repay, withdraw) work end-to-end with real ZK proofs
- Deliver 100% passing Anchor test suite on local validator

Context
- Link PRD sections: Privacy-first lending, ZK circuits, Merkle commitments
- Relevant constraints/assumptions:
  - Circuits already implemented in `circuits/veillend/` (Poseidon + Merkle proof + LTV=70%)
  - Solana Anchor programs in `programs/veillend/`
  - TypeScript SDK in `src/sdk/`
- Interfaces this task must respect:
  - IDL from `programs/veillend/target/idl/veillend.json`
  - ZK proof format: Groth16 with public inputs [merkleRoot, nullifierHash, oldCommitment, newCommitment]
  - Note string format: `veil-note-v1:<hex>` (for SDK integration)

Preflight checklist (Zero-Interruption)
- Files to read (globs): `programs/veillend/**`, `circuits/veillend/**`, `src/sdk/**`, `tests/*.ts`
- Files to edit (exact paths):
- Tools required: `anchor`, `ts-mocha`, `node`
- Permissions risk: local validator process + build artifacts

Allowed paths (file ownership)
- Allowed:
  - `programs/veillend/**`
  - `tests/veillend.ts` (on-chain tests)
  - `tests/privacy_phase.ts` (SDK tests)
  - `src/sdk/**` (TypeScript SDK)
  - `circuits/veillend/**` (ZK circuits)
- Disallowed:
  - `src/components/**` (frontend UI)
  - `src/pages/**` (frontend pages)
  - `tests/ui/**` (Playwright UI tests)

Deliverables
- Code changes:
  - All Anchor instructions implemented and tested
  - ZK proof verification wired correctly on-chain
  - Merkle tree operations (append, verify) working
  - Nullifier tracking preventing double-spend
- Tests:
  - 100% passing tests in `anchor test` (25+ tests)
  - SDK privacy tests passing (`npx ts-mocha -p tsconfig.tests.json tests/privacy_phase.ts`)
- Docs:
- Update progress/Progress.txt with all test results

Verification plan (must run)
- Commands:
  ```bash
  # Build and test
  anchor build
  COPYFILE_DISABLE=1 anchor test

  # SDK tests
  npx ts-mocha -p tsconfig.tests.json tests/privacy_phase.ts
  ```
- Expected outputs:
  - All Anchor tests passing (no failures)
  - SDK privacy tests passing
- Evidence to paste into progress/Progress.txt:
  - Command output showing 100% pass rate
  - List of any failing tests (if any) with error details

Acceptance tests to flip (PRD.json IDs)
- AT-SECURE-001: Deposit with Merkle commitment
- AT-SECURE-002: Borrow with nullifier and Merkle proof
- AT-SECURE-003: Repay with new commitment
- AT-SECURE-004: Withdraw with new commitment
- AT-SECURE-005: Reject invalid ZK proofs
- AT-SECURE-006: Block double-spend with same nullifier

Notes / edge cases
- Wallet switching: Not applicable for on-chain tests (use generated test wallets)
- Caching / invalidation: Merkle tree state must persist between instructions
- Race conditions / confirmations: Use `confirmTransaction` in tests
- CU limits: Some instructions may require `ComputeBudgetProgram.requestUnits` (already added to repay/withdraw)

Hand-off
- What the integrator needs to know:
  - Program ID and IDL location
  - Test account setup instructions
  - Known limitations (e.g., max commitments, depth)
- Any follow-up tasks created:
  - None (backend workflow complete)

Current Status
- [x] Circuits implemented (Poseidon + Merkle proof + LTV=70%)
- [x] Anchor programs implemented
- [x] Merkle tree uses Poseidon hash (ADR-001)
- [x] Fixed CU limit issues in repay/withdraw
- [x] Fixed invalid instruction data error (removed kaminoProgram from test)
- [ ] All Anchor tests passing (IN PROGRESS)
- [ ] SDK tests verified
