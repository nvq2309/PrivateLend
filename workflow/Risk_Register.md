# Risk Register (ZK Rewrite)

## R1: Merkle hash mismatch
- Risk: circuits use Poseidon while on-chain uses SHA-256.
- Mitigation: align on Poseidon (preferred) or update circuits to SHA-256.

## R2: Circuit size / proving time
- Risk: heavy circuits slow UX.
- Mitigation: keep arithmetic minimal and avoid price feeds.

## R3: Note leakage
- Risk: note string mishandled or logged.
- Mitigation: keep note in localStorage only and avoid console logs.
