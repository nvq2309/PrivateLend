#!/usr/bin/env bash
set -euo pipefail

if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

export CHAIN="devnet"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
export DEPOSIT_SOL_AMOUNT="${DEPOSIT_SOL_AMOUNT:-0.1}"
export BOOTSTRAP_USDC="${BOOTSTRAP_USDC:-true}"
export COPYFILE_DISABLE="${COPYFILE_DISABLE:-1}"

DEMO_FAST_ONLY=false
for arg in "$@"; do
  if [ "$arg" = "--demo-fast-only" ]; then
    DEMO_FAST_ONLY=true
  fi
done

if [ "$DEMO_FAST_ONLY" = "true" ]; then
  export DEMO_FAST_ONLY=true
fi

if [ -n "${DEPLOYER_KEYPAIR:-}" ] && [ -z "${ANCHOR_WALLET:-}" ]; then
  export ANCHOR_WALLET="$DEPLOYER_KEYPAIR"
fi

echo "[bootstrap] building program..."
anchor build

if [ -f "target/idl/veillend.json" ]; then
  mkdir -p src/idl
  cp target/idl/veillend.json src/idl/veillend.json
  echo "[bootstrap] copied IDL into src/idl/veillend.json"
fi

echo "[bootstrap] deploying program..."
if [ -n "${DEPLOYER_KEYPAIR:-}" ]; then
  anchor deploy --provider.cluster devnet --provider.wallet "$DEPLOYER_KEYPAIR"
else
  anchor deploy --provider.cluster devnet
fi

echo "[bootstrap] running bootstrap..."
if [ "$DEMO_FAST_ONLY" = "true" ]; then
  node scripts/bootstrap.mjs --demo-fast-only
else
  node scripts/bootstrap.mjs
fi
