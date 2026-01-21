import { useCallback, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

import { ActionModal, ActionType } from './components/ActionModal';
import { Layout } from './components/Layout';
import { ProtectionTrancheCard, ProtectionTranche } from './components/ProtectionTrancheCard';
import { RiskIndicator } from './components/RiskIndicator';
import { useVeilLend } from './hooks/useVeilLend';
import { LendingMode } from './sdk/adapter';
import {
  NoteRecord,
  createInitialNoteRecord,
  rotateNoteRecord,
  saveNoteRecord,
} from './sdk/notes';
import { generateDemoProof, ProofArtifact } from './sdk/proof';
import { WSOL_MINT } from './config/solana';

const MARKET_BASE = {
  SOL: { price: 145.2, supplyApy: 6.5, borrowApy: 8.2, ltv: 0.75, liquidationThreshold: 0.85 },
  USDC: { price: 1.0, supplyApy: 12.1, borrowApy: 14.5, ltv: 0.8, liquidationThreshold: 0.9 },
};

const PROTECTION_TRANCHES: ProtectionTranche[] = [
  { id: 'buffer-1', name: 'Buffer I', triggerLtv: 0.72, coverageLimit: 50000, fee: 180, tier: 1 },
  { id: 'buffer-2', name: 'Buffer II', triggerLtv: 0.78, coverageLimit: 120000, fee: 420, tier: 2 },
  { id: 'buffer-3', name: 'Buffer III', triggerLtv: 0.84, coverageLimit: 300000, fee: 780, tier: 3 },
];

const toUiAmount = (amount: number, decimals: number) =>
  amount / Math.pow(10, decimals);

const formatAmount = (amount: number, decimals: number, maximumFractionDigits = 4) =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
  }).format(toUiAmount(amount, decimals));

const parseAmount = (value: string, decimals: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric * Math.pow(10, decimals));
};

const resolveSymbol = (mint?: PublicKey | null) => {
  if (!mint) return 'USDC';
  if (mint.equals(WSOL_MINT)) return 'SOL';
  return 'USDC';
};

const toShortHash = (value: string, length = 10) =>
  value.length > length ? `${value.slice(0, length)}...` : value;

const VEILLEND_ERROR_MAP: Record<string, string> = {
  VaultPaused: 'The vault is currently paused. Please try again later.',
  InsufficientCollateral: 'You don\'t have enough collateral for this action.',
  InsufficientShares: 'You don\'t have enough shares to withdraw.',
  OutstandingDebt: 'Please repay your debt before withdrawing.',
  BorrowLimitExceeded: 'This would exceed your borrowing limit (75% LTV).',
  MathOverflow: 'Calculation error. Try a smaller amount.',
  InsufficientLiquidity: 'Not enough liquidity in the vault.',
  HealthFactorTooLow: 'Your health factor is too low for this operation.',
  InvalidProtectionTier: 'Invalid protection tier selected.',
  NoProtection: 'You don\'t have an active protection subscription.',
  ProtectionExpired: 'Your protection subscription has expired.',
};

const parseTransactionError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  for (const [code, friendly] of Object.entries(VEILLEND_ERROR_MAP)) {
    if (message.includes(code)) return friendly;
  }

  if (message.includes('insufficient funds') || message.includes('0x1')) {
    return 'Insufficient funds for this transaction.';
  }
  if (message.includes('User rejected')) {
    return 'Transaction cancelled by user.';
  }
  if (message.includes('Blockhash not found') || message.includes('block height exceeded')) {
    return 'Transaction expired. Please try again.';
  }
  if (message.includes('AccountNotFound')) {
    return 'Account not found. You may need to deposit first.';
  }

  return message.length > 120 ? `${message.slice(0, 120)}...` : message;
};

const App = () => {
  const { publicKey } = useWallet();
  const [view, setView] = useState<'MARKET' | 'PORTFOLIO'>('MARKET');
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [activeSymbol, setActiveSymbol] = useState('SOL');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<LendingMode>('SECURE');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<NoteRecord | null>(null);
  const [successProof, setSuccessProof] = useState<ProofArtifact | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [proof, setProof] = useState<ProofArtifact | null>(null);
  const [pendingNote, setPendingNote] = useState<NoteRecord | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [importNoteHash, setImportNoteHash] = useState('');
  const [importLastTxnId, setImportLastTxnId] = useState('');
  const [draftNote, setDraftNote] = useState<NoteRecord | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const {
    cluster,
    note,
    myPosition,
    vaultStats,
    walletBalanceLamports,
    collateralBalanceLamports,
    borrowBalanceLamports,
    usdcBalanceLamports,
    usdcVaultCollateralLamports,
    collateralDecimals,
    borrowDecimals,
    collateralMint,
    borrowMintAddress,
    borrowCapacityLamports,
    protectionPoolStats,
    programError,
    fastAdapter,
    subscribeProtection,
    refreshNote,
    clearNote,
  } = useVeilLend();

  const collateralSymbol = resolveSymbol(collateralMint);
  const borrowSymbol = resolveSymbol(borrowMintAddress);

  const marketRows = useMemo(() => {
    const fallback = { price: 0, supplyApy: 0, borrowApy: 0, ltv: 0, liquidationThreshold: 0 };
    return [
      {
        symbol: collateralSymbol,
        ...(MARKET_BASE[collateralSymbol as keyof typeof MARKET_BASE] ?? fallback),
      },
      {
        symbol: borrowSymbol,
        ...(MARKET_BASE[borrowSymbol as keyof typeof MARKET_BASE] ?? fallback),
      },
    ];
  }, [borrowSymbol, collateralSymbol]);

  const maxByAction = useCallback(
    (action: ActionType) => {
      switch (action) {
        case 'SUPPLY':
          return toUiAmount(
            collateralMint.equals(WSOL_MINT)
              ? walletBalanceLamports
              : collateralBalanceLamports,
            collateralDecimals,
          );
        case 'WITHDRAW':
          return toUiAmount(myPosition?.deposit ?? 0, collateralDecimals);
        case 'BORROW':
          return toUiAmount(borrowCapacityLamports, borrowDecimals);
        case 'REPAY':
          return toUiAmount(borrowBalanceLamports, borrowDecimals);
        default:
          return 0;
      }
    },
    [
      borrowBalanceLamports,
      borrowCapacityLamports,
      borrowDecimals,
      collateralBalanceLamports,
      collateralDecimals,
      collateralMint,
      myPosition,
      walletBalanceLamports,
    ],
  );

  const decimalsByAction = useCallback(
    (action: ActionType) =>
      action === 'BORROW' || action === 'REPAY' ? borrowDecimals : collateralDecimals,
    [borrowDecimals, collateralDecimals],
  );

  const openAction = (action: ActionType, symbol: string) => {
    setActiveAction(action);
    setActiveSymbol(symbol);
    setAmount('');
    setMode('SECURE');
    setActionError(null);
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
    setActionSuccess(null);
    setSuccessNote(null);
    setSuccessProof(null);
  };

  const closeAction = () => {
    setActiveAction(null);
    setAmount('');
    setActionError(null);
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
  };

  const handleConfirm = async () => {
    if (!activeAction) return;
    if (!publicKey) {
      setActionError('Connect wallet to continue.');
      return;
    }

    const decimals = decimalsByAction(activeAction);
    const lamports = parseAmount(amount, decimals);
    if (!lamports) {
      setActionError('Enter a valid amount.');
      return;
    }

    setActionBusy(true);
    setActionError(null);
    setActionMessage(mode === 'SECURE' ? 'Submitting secure action...' : 'Submitting action...');
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
    setActionSuccess(null);
    setSuccessNote(null);
    setSuccessProof(null);
    const actionLabel = activeAction.toLowerCase();
    let nextNote: NoteRecord | null = null;

    try {
      let signature = '';
      switch (activeAction) {
        case 'SUPPLY':
          signature = await fastAdapter.supply(lamports);
          break;
        case 'BORROW':
          signature = await fastAdapter.borrow(lamports);
          break;
        case 'REPAY':
          signature = await fastAdapter.repay(lamports);
          break;
        case 'WITHDRAW':
          signature = await fastAdapter.withdraw(lamports);
          break;
        default:
          break;
      }

      if (mode === 'SECURE') {
        setActionMessage('Generating proof and rotating note...');
        const baseNote = note ?? (await createInitialNoteRecord(publicKey.toBase58()));
        const proofArtifact = await generateDemoProof({
          walletAddress: publicKey.toBase58(),
          noteHash: baseNote.noteHash,
          lastTxnId: baseNote.lastTxnId,
        });
        nextNote = await rotateNoteRecord(publicKey.toBase58(), signature, baseNote);
        setSuccessNote(nextNote);
        setSuccessProof(proofArtifact);
      }

      closeAction();
      showActionSuccess(`${actionLabel} completed successfully.`, mode === 'SECURE' && Boolean(nextNote));
    } catch (error) {
      setActionError(parseTransactionError(error));
    } finally {
      setActionBusy(false);
      setActionMessage('');
    }
  };

  const handleSaveNote = () => {
    if (!pendingNote) return;
    saveNoteRecord(pendingNote);
    refreshNote();
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 3000);
  };

  const showActionSuccess = (message: string, keepOpen = false) => {
    setActionSuccess(message);
    if (!keepOpen) {
      window.setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const dismissActionSuccess = () => {
    setActionSuccess(null);
    setSuccessNote(null);
    setSuccessProof(null);
  };

  const handleSaveSuccessNote = () => {
    if (!successNote) return;
    saveNoteRecord(successNote);
    refreshNote();
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 3000);
    dismissActionSuccess();
  };

  const showPageError = (message: string) => {
    setPageError(message);
    window.setTimeout(() => setPageError(null), 4000);
  };

  const handleImportNote = () => {
    if (!publicKey) {
      showPageError('Connect wallet to import a note.');
      return;
    }
    if (!importNoteHash) {
      showPageError('Paste the note hash to import.');
      return;
    }
    const record: NoteRecord = {
      version: 1,
      walletAddress: publicKey.toBase58(),
      noteHash: importNoteHash.trim(),
      lastTxnId: importLastTxnId.trim() || 'imported',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveNoteRecord(record);
    refreshNote();
    setImportNoteHash('');
    setImportLastTxnId('');
  };

  const handleCreateInitialNote = async () => {
    if (!publicKey) {
      showPageError('Connect wallet to create a note.');
      return;
    }
    const record = await createInitialNoteRecord(publicKey.toBase58());
    setDraftNote(record);
  };

  const handleSaveDraftNote = () => {
    if (!draftNote) return;
    saveNoteRecord(draftNote);
    refreshNote();
    setDraftNote(null);
  };

  const handlePurchaseProtection = async (tranche: ProtectionTranche) => {
    if (!publicKey) {
      showPageError('Connect wallet to purchase protection.');
      return;
    }
    try {
      await subscribeProtection(tranche.tier, 30);
    } catch (error) {
      showPageError(parseTransactionError(error));
    }
  };

  const handleSeedVault = async () => {
    if (!publicKey) {
      showPageError('Connect wallet to seed the vault.');
      return;
    }
    if (!vaultStats) {
      showPageError('Vault is not initialized yet.');
      return;
    }
    setSeedBusy(true);
    setSeedError(null);
    try {
      await fastAdapter.supply(seedAmountLamports);
      showActionSuccess(`Seeded vault with 1,000 ${collateralSymbol}.`);
    } catch (error) {
      setSeedError(parseTransactionError(error));
    } finally {
      setSeedBusy(false);
    }
  };

  const vaultCollateral = vaultStats?.totalCollateral ?? 0;
  const vaultBorrowed = vaultStats?.totalBorrowed ?? 0;
  const healthFactor = myPosition?.healthFactor ?? 0;
  const collateralPrice = MARKET_BASE[collateralSymbol as keyof typeof MARKET_BASE]?.price ?? 0;
  const tvlUsd = toUiAmount(vaultCollateral, collateralDecimals) * collateralPrice;
  const seedAmountLamports = Math.floor(1000 * Math.pow(10, collateralDecimals));
  const seedReady = collateralBalanceLamports >= seedAmountLamports;
  const showSeedVault = Boolean(vaultStats) && vaultCollateral === 0 && collateralSymbol === 'USDC';

  return (
    <Layout activeView={view} onViewChange={setView} clusterLabel={cluster.toUpperCase()}>
      <div className="space-y-8 animate-fade-up">
        {programError && (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-xs text-red-100">
            {programError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass p-6 rounded-3xl border-white/10">
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">
              Vault Collateral
            </p>
            <div className="space-y-1">
              <p className="text-2xl font-bold">
                {formatAmount(vaultCollateral, collateralDecimals)} {collateralSymbol}
              </p>
              {collateralSymbol !== 'USDC' && (
                <p className="text-sm text-slate-400">
                  {formatAmount(usdcVaultCollateralLamports, 6)} USDC
                </p>
              )}
            </div>
            {showSeedVault && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleSeedVault}
                  disabled={!seedReady || seedBusy}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {seedBusy ? 'Seeding vault...' : `Seed 1,000 ${collateralSymbol}`}
                </button>
                {!seedReady && (
                  <p className="text-[10px] text-slate-400">
                    Mint at least 1,000 {collateralSymbol} to your wallet to seed the vault.
                  </p>
                )}
                {seedError && (
                  <p className="text-[10px] text-red-300">{seedError}</p>
                )}
              </div>
            )}
          </div>
          <div className="glass p-6 rounded-3xl border-white/10">
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">
              Vault TVL
            </p>
            <p className="text-2xl font-bold">
              ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(tvlUsd)}
            </p>
          </div>
          <div className="glass p-6 rounded-3xl border-white/10">
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">
              Vault Borrowed
            </p>
            <p className="text-2xl font-bold text-red-300">
              {formatAmount(vaultBorrowed, borrowDecimals)} {borrowSymbol}
            </p>
          </div>
          <div className="glass p-6 rounded-3xl border-emerald-500/20 bg-emerald-500/[0.02]">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-1">
              Net APY
            </p>
            <p className="text-2xl font-bold text-emerald-400">+4.2%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {view === 'MARKET' ? (
              <div className="glass rounded-3xl overflow-hidden border-white/10">
                <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
                  <h2 className="font-bold flex items-center gap-2">
                    <span className="w-2 h-2 bg-cyan-400 rounded-full" />
                    VeilLend Markets
                  </h2>
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-slate-300">
                    LIVE RPC
                  </span>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[11px] text-slate-300 font-bold uppercase">
                      <th className="px-6 py-4">Asset</th>
                      <th className="px-6 py-4">Supply APY</th>
                      <th className="px-6 py-4">Borrow APY</th>
                      <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {marketRows.map((market) => (
                      <tr key={market.symbol} className="group hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-bold border border-white/10 group-hover:scale-110 transition-transform">
                              {market.symbol[0]}
                            </div>
                            <div>
                              <p className="font-bold">{market.symbol}</p>
                              <p className="text-xs text-slate-400 font-mono">
                                ${market.price.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-emerald-400 font-bold">{market.supplyApy}%</td>
                        <td className="px-6 py-5 text-red-400 font-bold">{market.borrowApy}%</td>
                        <td className="px-6 py-5">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openAction('SUPPLY', market.symbol)}
                              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-emerald-500/20 hover:text-emerald-300 border border-white/10 transition-all text-xs font-bold"
                            >
                              Supply
                            </button>
                            <button
                              type="button"
                              onClick={() => openAction('BORROW', market.symbol)}
                              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 hover:text-cyan-200 border border-white/10 transition-all text-xs font-bold"
                            >
                              Borrow
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold">Your Shielded Position</h2>
                  <div className="bg-white/5 p-1 rounded-lg flex border border-white/10 text-[10px] font-bold">
                    <span className="px-3 py-1 bg-white/10 rounded">ACTIVE</span>
                    <span className="px-3 py-1 text-slate-400">HISTORY</span>
                  </div>
                </div>

                {!note ? (
                  <div className="glass rounded-3xl p-10 border-dashed border-2 border-white/10 space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center">
                        <span className="text-lg">!</span>
                      </div>
                      <div>
                        <p className="text-slate-200 font-semibold">Note required</p>
                        <p className="text-xs text-slate-300">
                          Import an existing note or create an initial note to unlock your position.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <p className="text-xs uppercase tracking-widest text-slate-300 font-bold">
                          Import note
                        </p>
                        <input
                          type="text"
                          value={importNoteHash}
                          onChange={(event) => setImportNoteHash(event.target.value)}
                          placeholder="Note hash"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm"
                        />
                        <input
                          type="text"
                          value={importLastTxnId}
                          onChange={(event) => setImportLastTxnId(event.target.value)}
                          placeholder="Last txn id (optional)"
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm"
                        />
                        <button
                          type="button"
                          onClick={handleImportNote}
                          className="w-full py-3 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20"
                        >
                          Save note
                        </button>
                      </div>

                      <div className="space-y-3">
                        <p className="text-xs uppercase tracking-widest text-slate-300 font-bold">
                          Create initial note
                        </p>
                        <button
                          type="button"
                          onClick={handleCreateInitialNote}
                          className="w-full py-3 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40"
                        >
                          Generate note
                        </button>
                        {draftNote && (
                          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs space-y-2">
                            <p className="text-[10px] uppercase tracking-widest text-slate-300 font-bold">
                              Draft note
                            </p>
                            <p className="font-mono break-all text-emerald-300">
                              {draftNote.noteHash}
                            </p>
                            <button
                              type="button"
                              onClick={handleSaveDraftNote}
                              className="w-full py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20"
                            >
                              Save to storage
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black px-2 py-0.5 rounded bg-emerald-400 text-slate-900">
                          POSITION
                        </span>
                        <button
                          type="button"
                          onClick={clearNote}
                          className="text-[10px] uppercase tracking-widest text-slate-300 hover:text-white"
                        >
                          Clear note
                        </button>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-1">
                          {formatAmount(myPosition?.deposit ?? 0, collateralDecimals)} {collateralSymbol}
                        </h3>
                        <p className="text-xs text-slate-300">Collateral deposited</p>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-red-300 mb-1">
                          {formatAmount(myPosition?.borrow ?? 0, borrowDecimals)} {borrowSymbol}
                        </h3>
                        <p className="text-xs text-slate-300">Debt outstanding</p>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => openAction('WITHDRAW', collateralSymbol)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10"
                        >
                          Withdraw
                        </button>
                        <button
                          type="button"
                          onClick={() => openAction('REPAY', borrowSymbol)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10"
                        >
                          Repay
                        </button>
                      </div>
                    </div>

                    <div className="glass p-6 rounded-3xl border border-white/10 space-y-4">
                      <p className="text-[10px] uppercase tracking-widest text-slate-300 font-bold">
                        Active note
                      </p>
                      <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                        <p className="text-[10px] text-slate-300 font-bold mb-2 uppercase tracking-tighter">
                          Note hash
                        </p>
                        <code className="text-[11px] block break-all font-mono text-emerald-300">
                          {note.noteHash}
                        </code>
                      </div>
                      <div className="text-xs text-slate-300 space-y-1">
                        <div className="flex justify-between">
                          <span>Last tx</span>
                          <span className="text-slate-200">{toShortHash(note.lastTxnId, 12)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Updated</span>
                          <span className="text-slate-200">
                            {new Date(note.updatedAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAction('SUPPLY', collateralSymbol)}
                        className="w-full py-3 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40"
                      >
                        Add collateral
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PROTECTION_TRANCHES.map((tranche) => (
                <ProtectionTrancheCard
                  key={tranche.id}
                  tranche={tranche}
                  onPurchase={handlePurchaseProtection}
                />
              ))}
            </section>
          </div>

          <div className="space-y-6">
            <section className="glass rounded-3xl p-5 border-cyan-500/30 bg-gradient-to-br from-cyan-500/[0.08] to-blue-500/[0.04]">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <h3 className="text-xs font-black uppercase tracking-widest text-cyan-300">
                  Wallet Balance
                </h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-black/20 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center font-bold text-xs text-white">
                      S
                    </div>
                    <span className="text-sm font-semibold text-slate-200">SOL</span>
                  </div>
                  <span className="text-lg font-bold font-mono text-white">
                    {formatAmount(walletBalanceLamports, 9, 4)}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-black/20 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center font-bold text-xs text-white">
                      $
                    </div>
                    <span className="text-sm font-semibold text-slate-200">USDC</span>
                  </div>
                  <span className="text-lg font-bold font-mono text-white">
                    {formatAmount(usdcBalanceLamports, 6, 2)}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-black/20 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center font-bold text-xs text-white">
                      B
                    </div>
                    <span className="text-sm font-semibold text-slate-200">Borrow Token</span>
                  </div>
                  <span className="text-lg font-bold font-mono text-white">
                    {formatAmount(borrowBalanceLamports, borrowDecimals, 2)}
                  </span>
                </div>
              </div>
            </section>

            <section className="glass rounded-3xl p-6 border-white/10">
              <RiskIndicator health={healthFactor} label="Personal Health" />

              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-3">
                  Your Position
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Deposited</span>
                    <span className="font-bold font-mono text-emerald-300">
                      {formatAmount(myPosition?.deposit ?? 0, collateralDecimals, 4)} {collateralSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Borrowed</span>
                    <span className="font-bold font-mono text-red-300">
                      {formatAmount(myPosition?.borrow ?? 0, borrowDecimals, 2)} {borrowSymbol}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="glass rounded-3xl p-6 border-emerald-500/20 bg-emerald-500/[0.02]">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                <h3 className="text-[11px] font-black text-emerald-400 uppercase tracking-widest">
                  Broker Advice
                </h3>
              </div>
              <p className="text-sm italic text-slate-200 leading-snug font-accent">
                "{healthFactor > 1.7
                  ? 'Aggregate position looks stable. Consider increasing reserves to hedge tail risk.'
                  : 'Risk elevated. Add collateral or reduce borrow exposure before volatility spikes.'}"
              </p>
            </section>

            <section className="glass rounded-3xl p-6 border-white/10">
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs uppercase tracking-widest text-slate-300 font-bold">
                  Protection Reserve
                </p>
                <span className="text-[10px] text-slate-400">{protectionPoolStats?.totalSubscribers ?? 0} members</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-300">Reserve</span>
                  <span className="font-bold">
                    {formatAmount(protectionPoolStats?.reserveBalance ?? 0, collateralDecimals)} {collateralSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Coverage</span>
                  <span className="font-bold">
                    {formatAmount(protectionPoolStats?.totalCoverage ?? 0, borrowDecimals)} {borrowSymbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Premiums</span>
                  <span className="font-bold">
                    {formatAmount(protectionPoolStats?.totalPremiumCollected ?? 0, borrowDecimals)} {borrowSymbol}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeAction && (
        <ActionModal
          open={Boolean(activeAction)}
          action={activeAction}
          assetSymbol={activeSymbol}
          amount={amount}
          maxAmount={maxByAction(activeAction)}
          mode={mode}
          busy={actionBusy}
          error={actionError}
          note={note}
          pendingNote={pendingNote}
          proof={proof}
          onAmountChange={setAmount}
          onModeChange={setMode}
          onConfirm={handleConfirm}
          onClose={closeAction}
          onSaveNote={pendingNote ? handleSaveNote : undefined}
          onMaxClick={() => setAmount(String(maxByAction(activeAction).toFixed(4)))}
        />
      )}

      {actionSuccess && (
        <div className="fixed bottom-6 right-6 w-80 max-w-[90vw] bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 px-4 py-3 rounded-2xl text-xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">{actionSuccess}</p>
            <button
              type="button"
              onClick={dismissActionSuccess}
              className="text-emerald-200/70 hover:text-emerald-100"
            >
              <span className="sr-only">Dismiss</span>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {successNote && successProof && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-100/80 font-bold mb-1">
                  Proof hash
                </p>
                <p className="font-mono break-all text-emerald-100">
                  {successProof.proofHash}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-100/80 font-bold mb-1">
                  New note
                </p>
                <p className="font-mono break-all text-emerald-100">
                  {successNote.noteHash}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveSuccessNote}
                className="w-full rounded-lg border border-emerald-300/40 bg-emerald-500/30 px-3 py-2 text-[11px] font-bold text-emerald-50 hover:bg-emerald-500/40"
              >
                Save to storage
              </button>
            </div>
          )}
        </div>
      )}

      {noteSaved && (
        <div className="fixed bottom-20 right-6 bg-emerald-500/10 border border-emerald-400/30 text-emerald-100 px-4 py-2 rounded-full text-xs">
          Note saved to storage.
        </div>
      )}

      {pageError && (
        <div className="fixed bottom-6 left-6 bg-red-500/20 border border-red-400/40 text-red-100 px-4 py-2 rounded-full text-xs">
          {pageError}
        </div>
      )}

      {actionBusy && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-lg z-[200] flex items-center justify-center p-8">
          <div className="text-center space-y-6 max-w-sm">
            <div className="relative">
              <div className="w-24 h-24 border-2 border-emerald-500/10 rounded-full mx-auto animate-pulse" />
              <div className="absolute inset-0 w-24 h-24 border-t-2 border-emerald-500 rounded-full animate-spin mx-auto" />
            </div>
            <div className="space-y-2">
              <p className="text-2xl font-bold tracking-tight">
                {actionMessage || 'Processing'}
              </p>
              <p className="text-sm text-slate-300 italic font-accent">
                "Privacy is a human right. Validating cryptographically..."
              </p>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
