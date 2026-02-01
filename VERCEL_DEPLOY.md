# Deploy to Vercel

## Quick Start

1. **Push code to GitHub** (already done)
2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Framework preset: Vite
3. **Configure Environment Variables** in Vercel Dashboard:

### Required Environment Variables

```
VITE_SOLANA_CLUSTER=devnet
VITE_PROGRAM_ID_DEVNET=EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t
VITE_IDL_ACCOUNT_DEVNET=Fh3iud2GQ6i8e2xRkFw8tX4TeMfpRS9L1FisiLB4CjSY
VITE_SOL_VAULT_DEVNET=EAB5dXu6rqS22y6z89BZHvbmZS6HniFNwNPLaPvPQuTT
VITE_USDC_VAULT_DEVNET=5pbUL4pGFbKacBa2W8quxtPgBWNrQ1Jx3gRtUnjkCVaX
VITE_USDC_MINT=GjNfu6ytFN7CSezpdQMeAEUFFUhZC9yRakM95uadKxx5
VITE_COLLATERAL_MINT=So11111111111111111111111111111111111111112
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
```

### Build Settings (Auto-detected)

- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Framework**: Vite

### SPA Routing

The `vercel.json` handles client-side routing:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## Security Notes

- ✅ **Safe to deploy**: All env vars above are public (addresses + public RPC)
- ❌ **Never add**: `.keys/` folder, private keys, RPC API keys with secrets
- ✅ **Wallet connection**: Users connect their own wallet (Phantom/Backpack)
- ❌ **No backend needed**: This is a pure frontend dApp

## Troubleshooting

**"Cannot connect to Solana"**
- Check `VITE_SOLANA_RPC_URL` is set to `https://api.devnet.solana.com`

**"Program not found"**
- Verify `VITE_PROGRAM_ID_DEVNET` matches the deployed program

**Build fails**
- Check Node.js version is 18+ in Vercel settings

## Current Devnet Deployment

- Program ID: `EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t`
- IDL Account: `Fh3iud2GQ6i8e2xRkFw8tX4TeMfpRS9L1FisiLB4CjSY`
- SOL Vault: `EAB5dXu6rqS22y6z89BZHvbmZS6HniFNwNPLaPvPQuTT`
- USDC Vault: `5pbUL4pGFbKacBa2W8quxtPgBWNrQ1Jx3gRtUnjkCVaX`
