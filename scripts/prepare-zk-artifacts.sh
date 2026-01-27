#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/circuits/veillend/build"
OUT_DIR="$ROOT_DIR/public/zk"

mkdir -p "$OUT_DIR"

hash_file() {
  local file="$1"
  if [ -f "$file" ]; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "missing"
  fi
}

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

manifest="$OUT_DIR/manifest.json"
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

{
  echo "{"
  echo "  \"generatedAt\": \"$timestamp\","
  echo "  \"actions\": {"
  for action in supply borrow repay withdraw; do
    wasm="$OUT_DIR/$action/${action}.wasm"
    zkey="$OUT_DIR/$action/setup_final.zkey"
    wasm_hash=$(hash_file "$wasm")
    zkey_hash=$(hash_file "$zkey")
    version="$wasm_hash:$zkey_hash"
    comma=","
    if [ "$action" = "withdraw" ]; then
      comma=""
    fi
    echo "    \"$action\": {\"wasm\": \"$wasm_hash\", \"zkey\": \"$zkey_hash\", \"version\": \"$version\"}$comma"
  done
  echo "  }"
  echo "}"
} > "$manifest"
