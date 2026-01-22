# PRD 03 — VeilLend: Private Lending Broker Layer (Kamino/marginfi Integration + Liquidation Mitigation)

## 0) One-liner
A “private lending broker” that sits between users and an existing Solana lending market (e.g., **Kamino** or **marginfi**), pooling positions and issuing private receipts so that outside observers see a **single aggregated posture**, while users keep individualized exposure, plus optional **liquidation mitigation** inspired by Fluid (tick/batch concepts) and Concrete Protect (tranche-style credit injection).

## 1) Why this exists (problem)
Direct lending/borrowing is transparent:
- user health factor, collateral, and liquidation risk can be monitored by anyone,
- whales get targeted; positions get sandwiched at liquidation boundaries,
- users suffer “cliff liquidations” during volatile moves.

We want:
- **Position privacy** (reduce per-user visibility), and
- **Smoother liquidation outcomes** (partial / buffered / pre-emptive de-risking).

## 2) Scope and constraints (demo-first)
### In-scope (MVP)
- Integrate programmatically with at least one lending protocol:
  - **Kamino** SDK / APIs, or
  - **marginfi** SDK/docs.
- User deposits into VeilLend; VeilLend maintains an aggregated position on the underlying protocol.
- A protection module with a simple, explicit mechanism:
  - risk thresholds,
  - reserve-based repay/boost collateral,
  - “tranche” purchase UI.

### Out-of-scope (MVP)
- Claiming “trustless” liquidation prevention without reserves.
- Modifying the underlying protocol’s liquidation engine.
- Full ZK proofs for every balance transition (roadmap).

## 3) Target users
- Borrowers with large positions who dislike being tracked.
- LPs who want privacy around strategies (leveraged loops, LST collateral).
- DAOs/treasuries managing leveraged positions.

## 4) Product surfaces
### 4.1 Portfolio / positions
- “Your private position” card: collateral, debt, risk tier, protection status.
- “Receipt” tab: proof of ownership / claim to withdraw.

### 4.2 Borrow / repay / add collateral
- Simplified actions: Deposit collateral → Borrow → Repay → Withdraw.

### 4.3 Protection center
- Buy protection tranches (e.g., 30-day term like Concrete Protect’s model).
- Show: max coverage, triggers, and fees.

## 5) Core user flow (step-by-step)
1. User connects wallet.
2. User deposits collateral into VeilLend vault.
3. VeilLend:
   - mints a **private receipt** for the user (claim on vault shares),
   - increases or rebalances the aggregated collateral position on underlying protocol (Kamino/marginfi).
4. User borrows via VeilLend UI:
   - VeilLend borrows from underlying protocol into its aggregated account.
   - VeilLend transfers borrowed asset to user (or to a chosen recipient).
5. User optionally buys Protection:
   - select plan + term (MVP: fixed 30-day cycle),
   - receive coverage tranches.
6. Monitoring:
   - if aggregated health approaches thresholds, VeilLend triggers mitigation:
     - repay part of debt using reserve (credit injection),
     - or add collateral / deleverage positions.
7. User repays and withdraws:
   - repay through VeilLend,
   - redeem receipt for collateral when safe.

## 6) Privacy model
### What we hide (MVP)
- Per-user mapping of collateral/debt to the underlying position.
- Per-user liquidation thresholds and posture.

### How (MVP)
- **Aggregation**: one or few large onchain positions on underlying protocol.
- **Receipts**: user holds proof of claim (vault shares).
- Optional: onchain commitments for receipts; offchain mapping kept minimal and encrypted.

### Merkle tree + nullifiers (demo implementation)
- A per-vault on-chain Merkle tree stores commitments for secure notes.
- Each SECURE action verifies a Merkle path for the current commitment and records a nullifier PDA to prevent double-spend.
- The action appends a new commitment, creating the next note state for the user.
- Limitation (demo): transactions are still signed by the user wallet; a relayer/stealth-address layer is required to fully unlink on-chain identities.

## 7) Liquidation mitigation (inspired, not copied)
### Fluid inspiration (ticks)
Fluid groups positions into “ticks” enabling batch liquidations. We emulate the *effect* at the broker layer:
- classify exposures into discrete “risk buckets” (tick-like),
- rebalance/partial deleverage at bucket boundaries instead of hard cliff per user.

### Concrete Protect inspiration (tranches + credit injection)
Concrete Protect uses a policy model (30-day term) and injects credit to improve LTV.
We implement:
- protection “tranches” purchased upfront,
- when risk threshold triggers, tranche activates to repay debt / add collateral from a reserve,
- user notified with clear audit trail.

## 8) Trust & verification model
- Broker is semi-trusted: it manages aggregated positions.
- Safety controls:
  - Public policy: max leverage, supported assets, reserve rules.
  - Transparency: show aggregate position health and proof of reserve balances.
- Roadmap:
  - Confidential compute for risk logic (Arcium / MagicBlock / Inco).
  - ZK proofs for “withdrawal correctness” and “policy compliance.”

## 9) Integrations (specific)
- **Kamino**: build docs + APIs/SDK for deposit/borrow/repay/withdraw.
- **marginfi**: docs + program interfaces / SDK.
- **Helius RPC**: indexing for position monitoring and UI refresh.
- Optional compliance: **Range** for pre-screening / allowlists.

## 10) Functional requirements
- FR1: Deposit collateral and mint a receipt.
- FR2: Borrow against collateral through underlying protocol integration.
- FR3: Repay + withdraw through receipt redemption.
- FR4: Protection purchase flow (plan, fee, term).
- FR5: Risk monitor with two thresholds:
  - Warning threshold,
  - Mitigation threshold (auto actions).
- FR6: Admin kill switch for mitigation actions.

## 11) Non-functional requirements
- NFR1: Safety: hard caps for borrow size; rate limits; allowlists in MVP.
- NFR2: UX: show “what can happen” with liquidation; avoid jargon.
- NFR3: Reliability: fallback to manual mitigation if automation fails.

## 12) Risks & mitigations
- R1: Reserve insufficiency → can’t prevent liquidation:
  - Mitigation: explicit coverage limits; show reserve ratio.
- R2: Aggregated position becomes a honeypot for attack:
  - Mitigation: audits, strict asset allowlist, limits, monitoring.
- R3: Underlying protocol changes:
  - Mitigation: use official SDKs; version pinning; integration tests.

## 13) Acceptance tests (UI flow + demo harness)

These acceptance tests extend the original MVP tests by adding a deterministic **demo environment bootstrap** and the **FAST vs SECURE** (privacy) UI flows for Supply/Borrow/Repay/Withdraw.

### 13.1 Demo environment bootstrap (localnet/devnet)
1. Initialize all contracts and deploy to the specified chain (localnet or devnet), including every program needed to demo: **supply, withdraw, borrow, repay**.
2. Airdrop **env.DEPLOYER** 5 SOL; then supply **4 SOL** into the Vault.
3. Create a USDC token mint (project-owned), mint **10^6 USDC** into the Vault.
4. Verify Vault balances: **4 SOL + 10^6 USDC**.
5. Airdrop **env.PUBLIC_WALLET** 2 SOL.

### 13.2 Notes + privacy modes (FAST vs SECURE)
6. Supply (FAST): user supplies SOL/USDC via the UI in FAST mode (no privacy) and the order is routed directly to the underlying lending market.
7. Supply (SECURE): user supplies SOL/USDC via the UI in SECURE mode; the app generates a **secret ownership proof** for the user’s position and returns a **note**. User can click “Save to storage” to persist the note to **LOCAL_STORAGE**.
8. Note uniqueness rule: each wallet has exactly **one active note**; the seed to derive the next note hash is:
   - `seed = timestamp + walletAddress + lastTxnId` where `lastTxnId = 0` if this is the initial note.
9. Borrow/Repay/Withdraw parity: Borrow, Repay, and Withdraw each support both FAST and SECURE modes with the same note/proof flow as Supply.
9b. SECURE actions must update the on-chain Merkle tree and create a nullifier PDA to prevent note reuse.

### 13.3 Portfolio UX
10. Portfolio requires note: on Portfolio page, if no note exists in LOCAL_STORAGE, the user must (a) input an existing note, or (b) create an initial note (guided flow). Once a note exists, positions are displayed and interactive.

### 13.4 Core lending correctness (broker layer)
11. Deposit creates a user receipt/note and increases the broker’s aggregated position accordingly.
12. Borrow decreases aggregate health appropriately and user receives borrowed assets.
13. Repay reduces debt; user can withdraw collateral when safe by presenting/burning the receipt/note.
14. Protection purchase (if enabled) is recorded; trigger simulation activates tranche and reduces risk metric.
15. Alerts show warning/trigger states correctly.

## 14) Hackathon mapping (Solana Privacy Hack 2026)
- Track: **Open Track** (consumer DeFi privacy app) or **Private Payments** (if private transfer primitives used in flows).
- Target bounties: Arcium, MagicBlock, Range, Helius, Privacy Cash, ShadowWire (optional).

## 15) Sources (public)
- Kamino developer docs (build/borrow) and SDK references.
- marginfi docs and program references.
- Fluid tick-based liquidation descriptions (public analysis + audits).
- Concrete Protect docs (30-day policy + credit injection).
- Solana Privacy Hack tracks + sponsor bounties.
