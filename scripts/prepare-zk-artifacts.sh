#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/circuits/veillend/build"
OUT_DIR="$ROOT_DIR/public/zk"

mkdir -p "$OUT_DIR"

for action in supply borrow repay withdraw; do
  ACTION_OUT="$OUT_DIR/$action"
  mkdir -p "$ACTION_OUT"

  wasm_src="$SRC_DIR/$action/${action}_js/${action}.wasm"
  zkey_src="$SRC_DIR/$action/setup_final.zkey"

  if [ -f "$wasm_src" ]; then
    cp "$wasm_src" "$ACTION_OUT/${action}.wasm"
  else
    echo "Missing wasm: $wasm_src"
  fi

  if [ -f "$zkey_src" ]; then
    cp "$zkey_src" "$ACTION_OUT/setup_final.zkey"
  else
    echo "Missing zkey: $zkey_src"
  fi
done
