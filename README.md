# VeilLend

Privacy-first lending broker on Solana. This repo contains:

- React + Vite UI in `src/`
- Anchor programs in `programs/`
- Test suites in `tests/`
- Demo bootstrap scripts in `scripts/`
- ZK circuits in `circuits/veillend`

## Agent Workflow
This repo uses an agentic SDLC workflow stored in `.agent-workflow/`.
Start here: `.agent-workflow/README.md` and `.agent-workflow/AGENTS.md`.

## Quick Start

```bash
# Clean install recommended to avoid dependency issues
rm -rf node_modules package-lock.json && npm install
```

## Environment Setup

```bash
cp .env.example .env
```

Set these in `.env`:

- `VITE_SOLANA_CLUSTER` (localnet | devnet)
- `VITE_PROGRAM_ID_LOCALNET`
- `VITE_PROGRAM_ID_DEVNET`
- `VITE_IDL_ACCOUNT_DEVNET`
- `VITE_SOL_VAULT_DEVNET`
- `VITE_USDC_VAULT_DEVNET`
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

## Demo Mode Smoke (/demo)

Quick UI smoke (mocked adapters):

```bash
npm run dev -- --mode e2e --host 127.0.0.1 --port 4173
```

Open `http://localhost:4173/demo` and verify the Markets + Portfolio panes render.

Localnet demo-fast-only (real chain, requires wallet):

```bash
COPYFILE_DISABLE=1 ./scripts/bootstrap-localnet.sh --demo-fast-only
npm run dev
```

Open `http://localhost:5173/demo` and run a quick supply/borrow/repay/withdraw.

## Deployment

### Localnet (Development)

The `scripts/bootstrap-localnet.sh` script automates the process of:
1. Building the Anchor program.
2. Starting a local validator (if not running, manually start it first if preferred).
3. Deploying the program.
4. bootstrapping initial state (mints, vault initialization).

```bash
# Start validator first in a separate terminal
./scripts/start-validator.sh

# Run deployment and bootstrap
./scripts/bootstrap-localnet.sh
```

### Devnet

To deploy to Solana Devnet:

1. ensure you have a valid keypair with Devnet SOL (~5 SOL recommended).
2. Configure `.env` with your devnet RPC and keypair path.

```bash
# Set your keypair
export DEPLOYER_KEYPAIR=~/.config/solana/id.json

# Run devnet bootstrap
./scripts/bootstrap-devnet.sh
```

For demo-fast-only (no Merkle init):

```bash
./scripts/bootstrap-devnet.sh --demo-fast-only
```

**Note:** The script will define `CHAIN="devnet"` and use `https://api.devnet.solana.com` by default.

#### Current Devnet Deployment (2026-02-01)

- Program ID: `EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t`
- IDL account: `Fh3iud2GQ6i8e2xRkFw8tX4TeMfpRS9L1FisiLB4CjSY`
- SOL vault: `EAB5dXu6rqS22y6z89BZHvbmZS6HniFNwNPLaPvPQuTT`
- USDC vault: `5pbUL4pGFbKacBa2W8quxtPgBWNrQ1Jx3gRtUnjkCVaX`
- USDC mint: `GjNfu6ytFN7CSezpdQMeAEUFFUhZC9yRakM95uadKxx5`
- Collateral mint (wSOL): `So11111111111111111111111111111111111111112`

### Testnet

Deployment to Testnet follows the same pattern as Devnet, but requires updating the RPC URL and Cluster settings manually or creating a `bootstrap-testnet.sh` variant.

```bash
export CHAIN="testnet"
export SOLANA_RPC_URL="https://api.testnet.solana.com"
export DEPLOYER_KEYPAIR=~/.config/solana/id.json

anchor build
anchor deploy --provider.cluster testnet
node scripts/bootstrap.mjs
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
# Ensure local validator is running first:
# ./scripts/start-validator.sh

TEST_GREP="Withdraw with LTV" COPYFILE_DISABLE=1 anchor test --skip-local-validator
```

Run randomized LTV tests:

```bash
# Default seed
TEST_GREP="Randomized" COPYFILE_DISABLE=1 anchor test --skip-local-validator

# Custom seed for reproducibility
TEST_SEED=my-custom-seed TEST_GREP="Randomized" COPYFILE_DISABLE=1 anchor test --skip-local-validator
```

### Comprehensive SC Security Tests (150 Scenarios)

Run the full 150-scenario security test suite:

```bash
# Ensure local validator is running:
# ./scripts/start-validator.sh

# Run all 150 randomized multi-action scenarios
TEST_GREP="Comprehensive" COPYFILE_DISABLE=1 anchor test --skip-local-validator

# With custom seed for reproducibility
TEST_SEED=security-audit-2024 TEST_GREP="Comprehensive" COPYFILE_DISABLE=1 anchor test --skip-local-validator
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
bash ./scripts/prepare-zk-artifacts.sh
```

## Known Limitations

- SECURE end-to-end tests are not yet passing (see AT-SECURE-001/002).
- Proof cache invalidation depends on `/public/zk/manifest.json`; ensure artifacts are refreshed after circuit rebuilds.

## Security Notes (Web3)

- Threat model: assumes validator honesty for syscall correctness and trusted setup integrity for Groth16.
- Key management: note strings and nullifiers are treated as secrets; do not log or share outside the holder.
- Non-goals: privacy against a compromised client device or leaked note strings.

## Troubleshooting

- **UI tests fail with "completed successfully" not found**: Make sure you ran `npm run build` before tests. The Playwright config serves from `dist/`.
- macOS Anchor test archive error: `rm -rf .anchor/test-ledger` then rerun with `COPYFILE_DISABLE=1`.
- Anchor test runner excludes Playwright specs via `Anchor.toml`.

## Deployments

UI: https://private-lend.vercel.app/
