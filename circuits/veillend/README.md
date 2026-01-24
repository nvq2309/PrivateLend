# VeilLend Circuits

Circom circuits for VeilLend secure actions. These circuits implement:

- Tornado-style note commitments
- Merkle inclusion proof
- Nullifier hash
- Action-specific constraints (LTV=70%)

## Files

- `note.circom` — note commitment + nullifier hash
- `merkle.circom` — Poseidon Merkle proof (depth 8)
- `utils.circom` — range checks and LTV check
- `supply.circom`
- `borrow.circom`
- `repay.circom`
- `withdraw.circom`

## Note fields (private inputs)

- nullifier (field)
- secret (field)
- supplySol (u64)
- supplyUsdc (u64)
- borrowSol (u64)
- borrowUsdc (u64)
- timestamp (u64)

## Public inputs

- merkleRoot
- nullifierHash
- oldCommitment
- newCommitment

## Build example

```bash
circom supply.circom --r1cs --wasm -o build/supply
snarkjs groth16 setup build/supply/supply.r1cs ceremony_final.ptau build/supply/setup_0000.zkey
snarkjs zkey contribute build/supply/setup_0000.zkey build/supply/setup_final.zkey
snarkjs zkey export verificationkey build/supply/setup_final.zkey build/supply/verification_key.json
```
