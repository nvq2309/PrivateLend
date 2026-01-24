import { clusterApiUrl, PublicKey } from '@solana/web3.js';

export type VeilLendCluster = 'localnet' | 'devnet';

const envCluster = import.meta.env.VITE_SOLANA_CLUSTER as VeilLendCluster | undefined;

export const SOLANA_CLUSTER: VeilLendCluster = envCluster ?? 'localnet';

const normalizeEnv = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const envRpcUrl = normalizeEnv(import.meta.env.VITE_SOLANA_RPC_URL);

export const SOLANA_ENDPOINT =
  envRpcUrl ??
  (SOLANA_CLUSTER === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl('devnet'));

const toPublicKey = (value: string | null) => (value ? new PublicKey(value) : null);

const envLocalProgramId = normalizeEnv(import.meta.env.VITE_PROGRAM_ID_LOCALNET);
const envDevnetProgramId = normalizeEnv(import.meta.env.VITE_PROGRAM_ID_DEVNET);

export const PROGRAM_ID_STRINGS: Record<VeilLendCluster, string | null> = {
  localnet: envLocalProgramId ?? 'EESy32LNihZW9iNTaGTuzCt1meWr5pjrDzt63fJEAE8t',
  devnet: envDevnetProgramId,
};

const envCollateralMint = normalizeEnv(import.meta.env.VITE_COLLATERAL_MINT);
const envUsdcMint = normalizeEnv(import.meta.env.VITE_USDC_MINT);
const envKaminoProgramId = normalizeEnv(import.meta.env.VITE_KAMINO_PROGRAM_ID);
const envKaminoMarket = normalizeEnv(import.meta.env.VITE_KAMINO_LENDING_MARKET);
const envKaminoMarketAuthority = normalizeEnv(import.meta.env.VITE_KAMINO_LENDING_MARKET_AUTHORITY);
const envKaminoObligation = normalizeEnv(import.meta.env.VITE_KAMINO_OBLIGATION);
const envKaminoBorrowReserve = normalizeEnv(import.meta.env.VITE_KAMINO_BORROW_RESERVE);
const envKaminoBorrowReserveLiquidityMint = normalizeEnv(
  import.meta.env.VITE_KAMINO_BORROW_RESERVE_LIQUIDITY_MINT,
);
const envKaminoReserveSourceLiquidity = normalizeEnv(
  import.meta.env.VITE_KAMINO_RESERVE_SOURCE_LIQUIDITY,
);
const envKaminoBorrowReserveLiquidityFeeReceiver = normalizeEnv(
  import.meta.env.VITE_KAMINO_BORROW_RESERVE_LIQUIDITY_FEE_RECEIVER,
);
const envKaminoReferrerTokenState = normalizeEnv(import.meta.env.VITE_KAMINO_REFERRER_TOKEN_STATE);
const envKaminoPythOracle = normalizeEnv(import.meta.env.VITE_KAMINO_PYTH_ORACLE);
const envKaminoSwitchboardOracle = normalizeEnv(import.meta.env.VITE_KAMINO_SWITCHBOARD_PRICE_ORACLE);
const envKaminoSwitchboardTwapOracle = normalizeEnv(
  import.meta.env.VITE_KAMINO_SWITCHBOARD_TWAP_ORACLE,
);
const envKaminoScopePrices = normalizeEnv(import.meta.env.VITE_KAMINO_SCOPE_PRICES);
const envKaminoRepayReserve = normalizeEnv(import.meta.env.VITE_KAMINO_REPAY_RESERVE);
const envKaminoReserveLiquidityMint = normalizeEnv(import.meta.env.VITE_KAMINO_RESERVE_LIQUIDITY_MINT);
const envKaminoReserveDestinationLiquidity = normalizeEnv(
  import.meta.env.VITE_KAMINO_RESERVE_DESTINATION_LIQUIDITY,
);

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Devnet USDC mint - fallback to a known devnet USDC if not provided
export const USDC_MINT = new PublicKey(
  envUsdcMint ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

export const DEFAULT_COLLATERAL_MINT = new PublicKey(envCollateralMint ?? WSOL_MINT.toBase58());

export const KAMINO_CONFIG = {
  programId: toPublicKey(envKaminoProgramId),
  lendingMarket: toPublicKey(envKaminoMarket),
  lendingMarketAuthority: toPublicKey(envKaminoMarketAuthority),
  obligation: toPublicKey(envKaminoObligation),
  borrowReserve: toPublicKey(envKaminoBorrowReserve),
  borrowReserveLiquidityMint: toPublicKey(envKaminoBorrowReserveLiquidityMint),
  reserveSourceLiquidity: toPublicKey(envKaminoReserveSourceLiquidity),
  borrowReserveLiquidityFeeReceiver: toPublicKey(envKaminoBorrowReserveLiquidityFeeReceiver),
  referrerTokenState: toPublicKey(envKaminoReferrerTokenState),
  pythOracle: toPublicKey(envKaminoPythOracle),
  switchboardPriceOracle: toPublicKey(envKaminoSwitchboardOracle),
  switchboardTwapOracle: toPublicKey(envKaminoSwitchboardTwapOracle),
  scopePrices: toPublicKey(envKaminoScopePrices),
  repayReserve: toPublicKey(envKaminoRepayReserve),
  reserveLiquidityMint: toPublicKey(envKaminoReserveLiquidityMint),
  reserveDestinationLiquidity: toPublicKey(envKaminoReserveDestinationLiquidity),
};
