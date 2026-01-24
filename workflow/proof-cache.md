# Proof Cache Strategy

## Goal

Avoid repeated on-chain proof verification calls when rendering positions.

## Cache key

- walletAddress + vaultAddress + noteHash + merkleRoot

## Cache contents

- lastVerifiedAt
- note payload (decoded balances + timestamp)
- commitment + nullifierHash
- merkleRoot used for verification

## Invalidation

- New secure action -> new note string -> invalidate old cache.
- Merkle root changes (new commitment appended) -> invalidate.
- Wallet switch -> clear wallet-specific cache.

## Storage

- localStorage key: veillend.proof_cache:{walletAddress}
- keep only most recent entry per wallet+vault to enforce one active note.
