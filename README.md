# VeilLend

Privacy-first lending broker on Solana. This repo contains:

- React + Vite UI in `src/`
- Anchor programs in `programs/`
- Test suites in `tests/`
- Demo bootstrap scripts in `scripts/`
- ZK circuits in `circuits/veillend`

## Quick Start

```bash
npm install
```

## Environment Setup

```bash
cp .env.example .env
```

Set these in `.env`:

- `VITE_SOLANA_CLUSTER` (localnet | devnet)
- `VITE_PROGRAM_ID_LOCALNET`
- `VITE_PROGRAM_ID_DEVNET`
- `VITE_COLLATERAL_MINT` (default WSOL)
- `VITE_USDC_MINT` (devnet USDC)
- `DEPLOYER_KEYPAIR` (path to deployer keypair)
- `PUBLIC_WALLET_KEYPAIR` (path to public demo wallet)

## Localnet / Localchain

Start a local validator (localnet) (use COPYFILE_DISABLE=1 on macOS):

```bash
COPYFILE_DISABLE=1 ./scripts/start-validator.sh
```

If bugged, try killing existing validators first:

```bash
rm -rf test-ledger
```

Run the demo bootstrap (build, deploy, seed balances):

```bash
COPYFILE_DISABLE=1 ./scripts/bootstrap-localnet.sh
```

## UI (Vite)

Dev server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview:

```bash
npm run preview
```

## Programs (Anchor)

Build programs:

```bash
anchor build
```

Deploy to localnet:

```bash
anchor deploy
```

## Tests

### UI Acceptance Tests (Playwright)

**Prerequisites:**
1. Install browsers: `npx playwright install`
2. Build the frontend: `npm run build`

**Run all UI tests:**
```bash
npm run test:ui
```

**Run specific test file:**
```bash
npx playwright test tests/ui/randomized.spec.ts
```

**Run with visible browser:**
```bash
npx playwright test --headed
```

### Massive Randomized E2E Tests (120 tests, 5-8 actions each)

Run the full 120-test randomized suite:
```bash
npx playwright test tests/ui/massive_randomized.spec.ts
```

With custom seed for reproducibility:
```bash
TEST_SEED=my-seed npx playwright test tests/ui/massive_randomized.spec.ts
```

Run in headed mode to watch:
```bash
npx playwright test tests/ui/massive_randomized.spec.ts --headed
```

On-chain tests (Anchor):

```bash
rm -rf .anchor/test-ledger && COPYFILE_DISABLE=1 anchor test
```

Anchor tests against an already-running validator:

```bash
anchor test --skip-local-validator
```

### New Smart Contract Tests

Run LTV-specific withdrawal tests:

```bash
COPYFILE_DISABLE=1 anchor test --skip-local-validator -- --grep "Withdraw with LTV"
```

Run randomized LTV tests:

```bash
# Default seed
COPYFILE_DISABLE=1 anchor test --skip-local-validator -- --grep "Randomized"

# Custom seed for reproducibility
TEST_SEED=my-custom-seed COPYFILE_DISABLE=1 anchor test --skip-local-validator -- --grep "Randomized"
```

### Comprehensive SC Security Tests (150 Scenarios)

Run the full 150-scenario security test suite:

```bash
# Run all 150 randomized multi-action scenarios
COPYFILE_DISABLE=1 anchor test --skip-local-validator -- --grep "Comprehensive"

# With custom seed for reproducibility
TEST_SEED=security-audit-2024 COPYFILE_DISABLE=1 anchor test --skip-local-validator -- --grep "Comprehensive"
```

Each scenario contains 5-8 mixed actions (supply, borrow, repay, withdraw) across 2 wallets, validating LTV constraints throughout.

### SDK-only Tests (Mocha)

```bash
npx ts-mocha -p tsconfig.tests.json tests/privacy_phase.ts
```

## ZK Circuits

Circom circuits live in `circuits/veillend`. See `circuits/veillend/README.md`
for build and proof generation steps.

To copy wasm/zkey artifacts into the web app (public/zk):

```bash
./scripts/prepare-zk-artifacts.sh
```

## Troubleshooting

- **UI tests fail with "completed successfully" not found**: Make sure you ran `npm run build` before tests. The Playwright config serves from `dist/`.
- macOS Anchor test archive error: `rm -rf .anchor/test-ledger` then rerun with `COPYFILE_DISABLE=1`.
- Anchor test runner excludes Playwright specs via `Anchor.toml`.
