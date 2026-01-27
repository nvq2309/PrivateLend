# Task Packet - Frontend Workflow

Task ID: WG-FRONTEND
Owner agent: Frontend UI/UX Engineer
Type: frontend
Priority: P0
Depends on: [specs-frozen]

Objective
- Build complete React UI for VeilLend privacy-first lending
- Implement note string UX (import/export, display, copy)
- Wire real ZK proof generation in browser via snarkjs
- Deliver 100% passing Playwright UI tests

Context
- Link PRD sections: Privacy lending UI, note string UX, ZK proof generation
- Relevant constraints/assumptions:
  - React + Vite + Tailwind CSS stack
  - Playwright for UI testing
  - Backend IDL available at `programs/veillend/target/idl/veillend.json`
  - ZK circuits available in `public/zk/` (wasm + zkey)
- Interfaces this task must respect:
  - Note string format: `veil-note-v1:<hex>`
  - SDK methods in `src/sdk/` (poseidon, arcium, proof, veilLend)
  - Wallet adapter interface (Phantom, etc.)

Preflight checklist (Zero-Interruption)
- Files to read (globs): `src/**`, `tests/ui/**`, `public/zk/**`
- Files to edit (exact paths):
- Tools required: `npm`, `playwright`, `vite`
- Permissions risk: snapshot updates, local storage access

Allowed paths (file ownership)
- Allowed:
  - `src/components/**`
  - `src/pages/**`
  - `src/hooks/**`
  - `src/App.tsx`
  - `src/main.tsx`
  - `public/zk/**` (ZK artifacts)
  - `tests/ui/**` (Playwright tests)
- Disallowed:
  - `programs/veillend/**` (Anchor programs)
  - `tests/veillend.ts` (on-chain tests)
  - `circuits/veillend/**` (ZK circuits)

Deliverables
- Code changes:
  - All UI components implemented (Markets, Dashboard, ActionModal, NoteManager)
  - Note string import/export working
  - ZK proof generation in browser via snarkjs
  - Wallet connection and transaction signing
  - Error handling and loading states
- Tests:
  - 100% passing Playwright UI tests (`npm run test:ui`)
- Docs:
- Update progress/Progress.txt with all test results

Verification plan (must run)
- Commands:
  ```bash
  # Build UI
  npm run build

  # Run Playwright tests
  npm run test:ui
  ```
- Expected outputs:
  - Build succeeds with no errors
  - All Playwright tests passing (26 tests)
- Evidence to paste into progress/Progress.txt:
  - Command output showing 100% pass rate
  - List of any failing tests (if any) with error details

Acceptance tests to flip (PRD.json IDs)
- AT-UI-001: Connect wallet and display balance
- AT-UI-002: View VeilLend Markets page
- AT-UI-003: Deposit collateral with note generation
- AT-UI-004: Borrow with ZK proof generation
- AT-UI-005: Repay with new commitment
- AT-UI-006: Withdraw with new commitment
- AT-UI-007: Copy note string to clipboard
- AT-UI-008: Import note from string
- AT-UI-009: Display encrypted balance
- AT-UI-010: Handle errors gracefully

Notes / edge cases
- Wallet switching: UI must handle wallet disconnect/reconnect gracefully
- Caching / invalidation: Notes should not be stored outside localStorage; use in-memory or secure storage
- Race conditions / confirmations: Show loading state during transaction confirmation
- ZK proof generation: May take 1-3 seconds; show progress indicator

Hand-off
- What the integrator needs to know:
  - Environment variables required (VITE_PROGRAM_ID_LOCALNET, VITE_PROGRAM_ID_DEVNET, etc.)
  - Build artifacts location
  - Known UI limitations (e.g., browser compatibility)
- Any follow-up tasks created:
  - None (frontend workflow complete)

Current Status
- [x] UI scaffolding exists
- [x] Note string format defined (`veil-note-v1:<hex>`)
- [x] ZK proof generation helpers in `src/sdk/proof.ts`
- [x] Wallet adapter integration
- [x] Fixed screenshot size mismatch (1280x1111 viewport)
- [x] Fixed missing "VeilLend Markets" on `/?e2e=1`
- [ ] All Playwright tests passing (IN PROGRESS - 26 failing tests remain)
- [ ] End-to-end integration with real backend
