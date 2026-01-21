#!/bin/bash
# Add local solana tools to PATH
export PATH=$HOME/.gemini/antigravity/brain/solana-tools/solana-release/bin:$PATH

# Program ID and Path
PROGRAM_ID="Veiiend111111111111111111111111111111111111"
PROGRAM_SO="target/deploy/veillend.so"

# Check if program exists
# if [ ! -f "$PROGRAM_SO" ]; then
#     echo "Error: $PROGRAM_SO not found. Did the build finish?"
#     exit 1
# fi

echo "Starting local validator (EMPTY - No Program Deployed)..."
solana-test-validator -r --bind-address 127.0.0.1
