#!/bin/bash

# Start local validator with optional devnet fork
# Usage: ./scripts/start-validator.sh [--fork]

set -e

export COPYFILE_DISABLE="${COPYFILE_DISABLE:-1}"

if [ "$1" == "--fork" ]; then
    echo "Starting local validator with devnet fork..."
    solana-test-validator \
        --reset \
        --url devnet \
        --clone-upgradeable-program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
        --clone-upgradeable-program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
        --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
        &
else
    echo "Starting fresh local validator..."
    solana-test-validator --reset &
fi

# Wait for validator to start
sleep 5

# Configure solana CLI to use localhost
solana config set --url localhost

echo "Validator started successfully!"
echo "RPC URL: http://localhost:8899"
