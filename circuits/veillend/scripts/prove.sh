#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: prove.sh <circuit> <input.json> <ptau>"
  exit 1
fi

CIRCUIT="$1"
INPUT="$2"
PTAU="$3"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build/$CIRCUIT"

snarkjs groth16 setup "$BUILD_DIR/$CIRCUIT.r1cs" "$PTAU" "$BUILD_DIR/setup_0000.zkey"
snarkjs zkey contribute "$BUILD_DIR/setup_0000.zkey" "$BUILD_DIR/setup_final.zkey" -e="veillend"
snarkjs groth16 fullprove "$INPUT" "$BUILD_DIR/$CIRCUIT.wasm" "$BUILD_DIR/setup_final.zkey" \
  "$BUILD_DIR/proof.json" "$BUILD_DIR/public.json"
snarkjs zkey export verificationkey "$BUILD_DIR/setup_final.zkey" "$BUILD_DIR/verification_key.json"
