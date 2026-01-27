# PRD — VeilLend (Agentic SDLC, ZK Rewrite)

Last updated: 2026-01-27

This PRD is written to be executable by AI agents:
- requirements are explicit
- unknowns are tracked
- verification commands are specified
- acceptance tests are in `PRD.json`

## 1) Context and current direction
The repository is currently in a “ZK rewrite” phase:
- Scope: ZK-first privacy notes with Merkle commitments and note string UX.
- Circuits exist and target Poseidon + Merkle proof + LTV=70%.
- SECURE acceptance tests are reset to `passes=false` until proof verification is wired end-to-end.

(These statements are enforced by `AGENTS.md`; do not override them casually.)

### Success metrics (demo phase)
- P0 acceptance tests pass with evidence recorded in `progress/Progress.txt`.
- Secure flow demo (supply → borrow → repay → withdraw) completes on localnet in under 5 minutes.
- UI smoke tests for secure flow pass (Playwright).

## 2) Users and primary workflows

### User story U1 — Secure supply
As a user, I want to supply collateral and receive a “note string” that represents my private position.

Acceptance expectations:
- User obtains a note string.
- Program state updates, but does not leak sensitive values beyond what is unavoidable.

### User story U2 — Secure borrow
As a user, I want to borrow against my private position by presenting a proof and receiving an updated note string.

Acceptance expectations:
- Borrow succeeds if within 70% LTV.
- Borrow fails otherwise.

### User story U3 — Secure repay
As a user, I want to repay and update my private position (new note).

Acceptance expectations:
- Repay reduces debt (invariants preserved).
- Over-repay behavior is specified and tested.

### User story U4 — Secure withdraw
As a user, I want to withdraw while maintaining LTV constraints.

Acceptance expectations:
- Withdraw succeeds when LTV remains healthy.
- Withdraw fails if it would break max LTV.

### User story U5 — FAST mode parity
As a developer, I want a non-private baseline (FAST mode) that matches SECURE semantics so we can debug and validate behavior.

Acceptance expectations:
- FAST and SECURE flows match on outcomes for equivalent action sequences (within the limits of what is observable).

## 3) Functional requirements

### P0 requirements (must ship for the first serious demo)
P0.1 End-to-end secure flow on localnet
- Secure supply → secure borrow → secure repay → secure withdraw works end-to-end.
- Proof verification is on-chain (not “demo-only”), and failures are surfaced clearly.
- UI positions are derived from verified note state (not raw wallet balances).
- Each secure action nullifies the prior note and appends a new commitment.
- SECURE actions require a valid ZK proof tied to the current Merkle commitment.

P0.2 LTV enforcement (70%)
- LTV rules must be enforced on-chain.
- Boundary cases must be tested (exactly at boundary, tiny withdrawals, etc.)

P0.3 Deterministic test harness
- Localnet bootstrap is scripted.
- Tests are reproducible via seed.
- “Harness failures” (validator not running, wrong CLI flags, missing deps) are handled via preflight steps.

P0.4 Clear UX contract for note strings
- The note string format is versioned.
- Encoding/decoding is deterministic across UI, SDK, and circuit assumptions.

### P1 requirements (post-demo hardening)
- Devnet demo flow
- Proof caching + artifact versioning (avoid stale/invalid proofs)
- UI smoke tests for the secure flow

## 4) Non-functional requirements (NFR)
NFR.1 Security posture (Web3)
- No silent failures in smart contract logic.
- Explicit error codes and negative tests.
- State-machine / invariant tests exist for core flows.

NFR.2 Developer experience
- The “happy path” commands are documented and work reliably.
- The project avoids long feedback loops: quick checks exist (smoke suite).

NFR.3 Performance
- Secure verification must fit within compute limits; transactions must fit within size limits.
- If compute/size constraints require compromises, the tradeoff must be recorded in an ADR.

## 5) Data and interface surfaces (high level)

### Note string
Canonical format (ASCII, versioned):
- `veil-note-v1:<hex>`

Payload (big-endian, 176 bytes total):
- noteHash (32 bytes)
- vaultAddress (32 bytes, raw public key bytes)
- nullifier (32 bytes)
- secret (32 bytes)
- supplySol (8 bytes)
- supplyUsdc (8 bytes)
- borrowSol (8 bytes)
- borrowUsdc (8 bytes)
- timestamp (8 bytes)
- noteIndex (8 bytes)

Derived values (must match circuits + on-chain):
- commitment = Poseidon(nullifier, secret, supplySol, supplyUsdc, borrowSol, borrowUsdc, timestamp)
- nullifierHash = Poseidon(nullifier, 0)

Notes:
- One active note per wallet at any time.
- Note hash is derived from `timestamp + walletAddress + lastTxnId` (see client note rotation).

### Program interfaces
At minimum, the program must expose:
- FAST instructions: supply/borrow/repay/withdraw
- SECURE instructions: secure_supply/secure_borrow/secure_repay/secure_withdraw
- Verifier / nullifier / merkle root update flows (as required)

SECURE proof public inputs (required):
- merkleRoot
- nullifierHash
- oldCommitment
- newCommitment

On-chain notes:
- The program does not parse note strings; it only validates proof inputs and updates state.
- Merkle tree stores commitments only; nullifier PDA prevents note reuse.

### Client/SDK interfaces
- encode/decode note string
- generate witness + proof
- submit transaction with proof and required accounts
- update local note state

### Circuit constraints (summary)
- oldCommitment matches Poseidon(note fields)
- nullifierHash matches Poseidon(nullifier, 0)
- Merkle proof verifies oldCommitment against merkleRoot
- Borrow LTV <= 70% and withdraw LTV preserved post-withdraw
- Interest = 0 (timestamp stored but not used in math)
- Merkle tree depth must match on-chain configuration
- LTV uses the same unit basis as note balances (no price feeds inside circuits)

### Proof cache strategy (P1 detail)
- Cache key: walletAddress + vaultAddress + noteHash + merkleRoot
- Cache invalidation: new note, merkle root change, wallet switch
- Storage: localStorage key `veillend.proof_cache:{walletAddress}` (most-recent per wallet+vault)

## 6) Major open decisions (must be resolved explicitly)
These are “blocking decisions” because they determine whether end-to-end proof verification can work:

D1) Hash function alignment: Poseidon vs SHA-256
- Circuits are Poseidon-based per current direction.
- On-chain logic must match the circuit assumptions, or SECURE mode will not verify.
Action: record the decision in ADR-0001.

D2) Proof system + verifier interface (Groth16 etc.)
Action: record the decision in ADR-0002.

D3) Note string minimal fields and forward compatibility
Action: record the decision in ADR-0003.

## 7) Verification strategy (summary)
See `Test_Plan.md` for details, but the required shape is:

- Preflight (validator + deps)
- FAST-mode contract tests (Anchor)
- SECURE-mode contract tests (Anchor)
- UI acceptance tests (Playwright)
- Parity tests (FAST vs SECURE)

## 8) Scope slicing strategy (how we avoid waterfall)
Instead of locking the entire system spec, we slice vertically:

Slice S1: Harness + note-string encode/decode (no proof)
Slice S2: Proof generation in-browser + proof cache (still no on-chain verify)
Slice S3: On-chain verify for ONE secure instruction (secure supply)
Slice S4: On-chain verify for the full secure loop (supply/borrow/repay/withdraw)
Slice S5: Parity tests + devnet demo

Each slice has its own acceptance tests in `PRD.json`.

## 9) Threat model (Web3)
- Key management assumptions: note strings and secrets are user-owned; compromised client devices are out of scope.
- Attacker model: on-chain observers, malicious RPCs, and UI injection attempts.
- Funds safety assumptions: on-chain verification enforces LTV and nullifier spend; client must not leak note strings.
- Frontend integrity assumptions: users load the intended UI build and do not paste notes into untrusted sites.

## 10) Acceptance tests mapping
- See `PRD.json` for P0/P1 acceptance test IDs and verification commands.
