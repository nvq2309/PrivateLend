#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
INCLUDE_DIR="$ROOT_DIR/../../node_modules"

mkdir -p "$BUILD_DIR/supply" "$BUILD_DIR/borrow" "$BUILD_DIR/repay" "$BUILD_DIR/withdraw"

circom "$ROOT_DIR/supply.circom" --r1cs --wasm -o "$BUILD_DIR/supply" -l "$INCLUDE_DIR"
circom "$ROOT_DIR/borrow.circom" --r1cs --wasm -o "$BUILD_DIR/borrow" -l "$INCLUDE_DIR"
circom "$ROOT_DIR/repay.circom" --r1cs --wasm -o "$BUILD_DIR/repay" -l "$INCLUDE_DIR"
circom "$ROOT_DIR/withdraw.circom" --r1cs --wasm -o "$BUILD_DIR/withdraw" -l "$INCLUDE_DIR"
