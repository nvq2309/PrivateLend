# VeilLend Testing Guide

## Prerequisites

Install Solana and Anchor toolchain:

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Verify installation
solana --version
anchor --version
```

## Running Tests

### Option 1: Fresh Local Validator (Recommended)
```bash
# Build the program
anchor build

# Run tests (automatically starts local validator)
anchor test
```

### Option 2: Fork Devnet (Like Hardhat Fork)
```bash
# Terminal 1: Start validator with devnet fork
./scripts/start-validator.sh --fork

# Terminal 2: Run tests against local validator
anchor test --skip-local-validator
```

### Option 3: Manual Testing
```bash
# Start validator manually
solana-test-validator --reset

# In another terminal
anchor build
anchor deploy

# Run tests
yarn test
```

## Test Flow

1. **Initialize**: Creates Vault and ProtectionPool with 75% LTV
2. **Deposit**: User deposits 10 tokens as collateral
3. **Borrow**: User borrows 5 tokens (within LTV limit)
4. **Repay**: User repays 2 tokens
5. **Withdraw**: User withdraws remaining collateral after clearing debt

## Troubleshooting

- **"Program not found"**: Run `anchor build && anchor deploy` first
- **"Insufficient funds"**: Airdrop more SOL: `solana airdrop 10`
- **"Account already exists"**: Reset validator: `solana-test-validator --reset`
