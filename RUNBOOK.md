# VeilLend Runbook

This runbook provides step-by-step instructions for setup, running, testing, and demoing VeilLend.

## Setup

1) Install dependencies

```bash
rm -rf node_modules package-lock.json && npm install
```

2) Configure environment

```bash
cp .env.example .env
```

Set required values:

- `VITE_SOLANA_CLUSTER` (localnet | devnet)
- `VITE_PROGRAM_ID_LOCALNET`
- `VITE_PROGRAM_ID_DEVNET`
- `VITE_COLLATERAL_MINT`
- `VITE_USDC_MINT`
- `DEPLOYER_KEYPAIR`
- `PUBLIC_WALLET_KEYPAIR`

## Localnet Boot

1) Start validator (macOS: use COPYFILE_DISABLE=1)

```bash
COPYFILE_DISABLE=1 ./scripts/start-validator.sh
```

2) Bootstrap localnet (build + deploy + seed balances)

```bash
COPYFILE_DISABLE=1 ./scripts/bootstrap-localnet.sh
```

For demo-fast-only bootstrap (note-fast flows, no Merkle init):

```bash
COPYFILE_DISABLE=1 ./scripts/bootstrap-localnet.sh --demo-fast-only
```

## ZK Artifacts

If circuits are rebuilt, refresh UI artifacts:

```bash
bash ./scripts/prepare-zk-artifacts.sh
```

## UI

```bash
npm run dev
```

## Demo Smoke (/demo)

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

For production-like UI tests, build first:

```bash
npm run build
```

## Testing

### Targeted Anchor Tests (fast loop)

```bash
TEST_GREP="Withdraw with LTV" COPYFILE_DISABLE=1 anchor test --skip-local-validator
```

### Randomized Security Suite

```bash
TEST_GREP="Comprehensive" COPYFILE_DISABLE=1 anchor test --skip-local-validator
```

### SDK Tests

```bash
npx ts-mocha -p tsconfig.tests.json tests/privacy_phase.ts
```

### UI Tests

```bash
npm run test:ui
```

## Demo Flow (Localnet)

1) Bootstrap localnet.
2) Open UI and connect the demo wallet.
3) Supply collateral to create the first note (FAST).
4) Perform a second supply to trigger SECURE spend (proof generation + verify).
5) Borrow and repay using the same note.
6) Withdraw while maintaining LTV limits.

## Troubleshooting

- `ComputeBudgetExceeded`: add `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` for secure transactions.
- `ECONNREFUSED 127.0.0.1:8899`: validator not running; rerun bootstrap.
- macOS archive error: `rm -rf .anchor/test-ledger` then rerun with `COPYFILE_DISABLE=1`.
