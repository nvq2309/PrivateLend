import { clusterApiUrl, PublicKey } from '@solana/web3.js';

export type VeilLendCluster = 'localnet' | 'devnet';

const envCluster = import.meta.env.VITE_SOLANA_CLUSTER as VeilLendCluster | undefined;

export const SOLANA_CLUSTER: VeilLendCluster = envCluster ?? 'localnet';

export const SOLANA_ENDPOINT =
  SOLANA_CLUSTER === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl('devnet');

const normalizeEnv = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const envLocalProgramId = normalizeEnv(import.meta.env.VITE_PROGRAM_ID_LOCALNET);
const envDevnetProgramId = normalizeEnv(import.meta.env.VITE_PROGRAM_ID_DEVNET);

export const PROGRAM_ID_STRINGS: Record<VeilLendCluster, string | null> = {
  localnet: envLocalProgramId ?? 'EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t',
  devnet: envDevnetProgramId,
};

const envCollateralMint = normalizeEnv(import.meta.env.VITE_COLLATERAL_MINT);
const envUsdcMint = normalizeEnv(import.meta.env.VITE_USDC_MINT);

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Devnet USDC mint - fallback to a known devnet USDC if not provided
export const USDC_MINT = new PublicKey(
  envUsdcMint ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

export const DEFAULT_COLLATERAL_MINT = new PublicKey(envCollateralMint ?? WSOL_MINT.toBase58());
