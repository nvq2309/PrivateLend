# Progress Log

## Session: Devnet deploy + bootstrap (demo-fast-only)
**Date:** 2026-02-01
**Agent:** Sisyphus

### Goals
- Deploy veillend program to devnet using funded deployer keypair.
- Bootstrap demo-fast-only with no airdrops and verify vault balances.

### Log
- [x] Built program and deployed to devnet with deployer wallet.
  - Outcome: pass
  - Notes: Program Id `EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t`; IDL account created.
- [x] Ran bootstrap (demo-fast-only).
  - Outcome: pass
  - Notes: airdrops skipped; vault/mints/protection initialized; deposits 0.1 SOL + 10,000 USDC; balances verified; `VITE_USDC_MINT` updated.

### Preflight (Zero-Interruption)
- Files read: `scripts/bootstrap-devnet.sh`, `scripts/bootstrap.mjs`, `.env`
- Files edited: `.env`, `scripts/bootstrap.mjs`, `scripts/bootstrap-devnet.sh`
- Tools/permissions checked: `solana-keygen pubkey`, `solana balance`

### Results
- Commands run: `bash ./scripts/bootstrap-devnet.sh --demo-fast-only`
- Pass/fail counts: 1 passing, 0 failing.
- Issues resolved: deployer keypair regenerated from base58 secret; airdrops disabled on devnet.
- Confirmation: Devnet deploy + bootstrap completed successfully.
