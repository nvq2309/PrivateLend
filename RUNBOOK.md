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
- `VITE_IDL_ACCOUNT_DEVNET`
- `VITE_SOL_VAULT_DEVNET`
- `VITE_USDC_VAULT_DEVNET`
- `VITE_COLLATERAL_MINT`
- `VITE_USDC_MINT`
- `VITE_SOLANA_RPC_URL` (devnet)
- `SOLANA_RPC_URL` (devnet)
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

## Devnet Boot

1) Ensure `.env` is set to devnet (RPC + program id). Avoid airdrops on devnet:

```bash
VITE_SOLANA_CLUSTER=devnet
BOOTSTRAP_AIRDROP=false
```

2) Deploy + bootstrap devnet:

```bash
bash ./scripts/bootstrap-devnet.sh --demo-fast-only
```

### Current Devnet Deployment (2026-02-01)

- Program ID: `EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t`
- IDL account: `Fh3iud2GQ6i8e2xRkFw8tX4TeMfpRS9L1FisiLB4CjSY`
- SOL vault: `EAB5dXu6rqS22y6z89BZHvbmZS6HniFNwNPLaPvPQuTT`
- USDC vault: `5pbUL4pGFbKacBa2W8quxtPgBWNrQ1Jx3gRtUnjkCVaX`
- USDC mint: `GjNfu6ytFN7CSezpdQMeAEUFFUhZC9yRakM95uadKxx5`
- Collateral mint (wSOL): `So11111111111111111111111111111111111111112`

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
