#!/usr/bin/env bash
set -euo pipefail

if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

export CHAIN="${CHAIN:-localnet}"
export SOLANA_RPC_URL="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
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
anchor deploy --provider.cluster localnet

echo "[bootstrap] running bootstrap..."
if [ "$DEMO_FAST_ONLY" = "true" ]; then
  node scripts/bootstrap.mjs --demo-fast-only
else
  node scripts/bootstrap.mjs
fi
