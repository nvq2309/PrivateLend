# Note + Merkle Flow (Target)

This is the target flow after the ZK-first rewrite.

## Note string format

Prefix + hex payload, ASCII only:

```
veil-note-v1:<hex>
```

Hex payload (big-endian):

- nullifier (32 bytes)
- secret (32 bytes)
- supplySol (8 bytes)
- supplyUsdc (8 bytes)
- borrowSol (8 bytes)
- borrowUsdc (8 bytes)
- timestamp (8 bytes)

Derived values (inside circuits):

- commitment = Poseidon(nullifier, secret, supplySol, supplyUsdc, borrowSol, borrowUsdc, timestamp)
- nullifierHash = Poseidon(nullifier)

## Merkle tree state

- Tree stores commitments only.
- Each secure action proves inclusion of the current commitment.
- Each action appends a new commitment computed from the updated balances.

## Action flow (SECURE)

1. User presents note string.
2. Client decodes note -> secret, nullifier, balances, timestamp.
3. Client builds Merkle proof (from local cached leaves or from chain indexing).
4. Client generates ZK proof:
   - current commitment in tree
   - nullifierHash not spent
   - action-specific constraints (e.g., borrow <= 70% supplied)
5. On-chain verifier validates proof and Merkle root.
6. Program marks nullifier as spent and appends new commitment.
7. Client outputs a new note string and stores it.

## Action flow (FAST)

- Direct supply/borrow/repay/withdraw without ZK proofs.

## Position display

- UI must display positions derived from verified note state,
  not from wallet balances.
- Cache verified proof results client-side to avoid repeated on-chain calls.
