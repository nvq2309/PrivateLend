# VeilLend

Privacy-first lending broker on Solana. This repo contains:
- React + Vite UI in `src/`
- Anchor programs in `programs/`
- Test suites in `tests/`
- Demo bootstrap scripts in `scripts/`

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

Start a local validator (localnet):
```bash
./scripts/start-validator.sh
```

Run the demo bootstrap (build, deploy, seed balances):
```bash
./scripts/bootstrap-localnet.sh
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

UI acceptance tests (Playwright):
```bash
npm run test:ui
```

On-chain tests (Anchor):
```bash
rm -rf .anchor/test-ledger && COPYFILE_DISABLE=1 anchor test
```

Anchor tests against an already-running validator:
```bash
anchor test --skip-local-validator
```

SDK-only tests (Mocha):
```bash
npx ts-mocha -p tsconfig.tests.json tests/privacy_phase.ts
```

## Troubleshooting

- macOS Anchor test archive error: `rm -rf .anchor/test-ledger` then rerun with `COPYFILE_DISABLE=1`.
- Anchor test runner excludes Playwright specs via `Anchor.toml`.
