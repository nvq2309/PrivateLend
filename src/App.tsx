import { useCallback, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

import { ActionModal, ActionType } from './components/ActionModal';
import { Layout } from './components/Layout';
import { RiskIndicator } from './components/RiskIndicator';
import { useVeilLend } from './hooks/useVeilLend';
import { LendingMode } from './sdk/adapter';
import {
  NoteRecord,
  createInitialNoteRecord,
  rotateNoteRecord,
  saveNoteRecord,
} from './sdk/notes';
import {
  createPrivacyNote,
  getNextNoteIndex,
  getUnspentNotes,
  loadPrivacyNotes,
  loadSecrets,
  initializeSecrets,
  savePrivacyNote,
  savePrivacyNotes,
  saveSecrets,
  toHex as toHexBytes,
  type PrivacyNoteV2,
} from './sdk/commitment';
import type { ZkProofResult } from './sdk/zkProof';
import {
  NOTE_STRING_PREFIX,
  buildNoteStringFromPrivacyNote,
  buildPrivacyNoteFromNoteString,
  decodeNoteString,
} from './sdk/noteString';
import { WSOL_MINT, USDC_MINT } from './config/solana';
import { isE2e } from './config/e2e';

import { SavedNotes } from './components/SavedNotes';

const MARKET_BASE = {
  SOL: { price: 145.2, supplyApy: 6.5, borrowApy: 8.2, ltv: 0.75, liquidationThreshold: 0.85 },
  USDC: { price: 1.0, supplyApy: 12.1, borrowApy: 14.5, ltv: 0.8, liquidationThreshold: 0.9 },
};

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
  if (mint.equals(USDC_MINT)) return 'USDC';
  return 'USDC';
};

const resolveBorrowSymbol = (borrowMint: PublicKey | null, collateralMint: PublicKey | null) => {
  if (borrowMint) return resolveSymbol(borrowMint);
  if (!collateralMint) return 'USDC';
  return collateralMint.equals(WSOL_MINT) ? 'USDC' : 'SOL';
};

const decimalsForSymbol = (symbol: string) => (symbol === 'SOL' ? 9 : 6);

const copyToClipboard = async (value: string) => {
  if (typeof navigator === 'undefined') return false;
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

const copyNoteString = async (noteRecord: NoteRecord | null) => {
  if (!noteRecord?.noteString) return false;
  return copyToClipboard(noteRecord.noteString);
};

const toShortHash = (value: string, length = 10) =>
  value.length > length ? `${value.slice(0, length)}...` : value;

const VEILLEND_ERROR_MAP: Record<string, string> = {
  VaultPaused: 'The vault is currently paused. Please try again later.',
  InsufficientCollateral: 'You don\'t have enough collateral for this action.',
  InsufficientShares: 'You don\'t have enough shares to withdraw.',
  OutstandingDebt: 'Please repay your debt before withdrawing.',
  BorrowLimitExceeded: 'This would exceed your borrowing limit (70% LTV). Replace amount or repay some debt.',
  MathOverflow: 'Calculation error. Try a smaller amount.',
  InsufficientLiquidity: 'Not enough liquidity in the vault.',
  HealthFactorTooLow: 'Your health factor is too low for this operation.',
  ArciumClientKeyMissing: 'Missing Arcium client key. Reconnect your wallet and try again.',
  ArciumClientKeyMismatch: 'Arcium client key mismatch. Clear local storage and reconnect.',
  InvalidVaultState: 'Vault state mismatch. Refresh and try again.',
  MerkleProofInvalid: 'Merkle proof failed. Refresh notes and try again.',
  MerkleTreeFull: 'Merkle tree is full. Try a different vault.',
  InvalidMerklePath: 'Merkle path invalid. Refresh notes and try again.',
  MerkleDepthMismatch: 'Merkle tree depth mismatch. Refresh and retry.',
  InvalidNoteHash: 'Note access hash mismatch. Re-import the latest note.',
};

const NOTE_ACCESS_STORAGE_PREFIX = 'veillend.note_access';

type NoteAccessRecord = {
  version: 1;
  noteHash: string;
  noteString?: string;
  privacyNotes: PrivacyNoteV2[];
  secrets: { blindingFactor: string; spendingKey: string };
  createdAt: number;
  updatedAt: number;
};

const isNoteHash = (value: string) => /^[0-9a-fA-F]{64}$/.test(value);


const parseTransactionError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (!message || message.trim().length === 0) {
    return 'Transaction failed. No error detail from wallet.';
  }

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
  const e2eEnabled = isE2e();
  const e2eOverride =
    typeof window !== 'undefined'
      ? (window as Window & { __VEILLEND_E2E_WALLET_PUBLIC_KEY__?: string })
          .__VEILLEND_E2E_WALLET_PUBLIC_KEY__
      : null;
  const walletAddress =
    publicKey?.toBase58() ?? e2eOverride ?? (e2eEnabled ? 'e2e-wallet' : null);
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
  const [successProof, setSuccessProof] = useState<ZkProofResult | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [proof, setProof] = useState<ZkProofResult | null>(null);
  const [pendingNote, setPendingNote] = useState<NoteRecord | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [importNoteHash, setImportNoteHash] = useState('');
  const [draftNote, setDraftNote] = useState<NoteRecord | null>(null);
  const [draftPrivacyNote, setDraftPrivacyNote] = useState<PrivacyNoteV2 | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const solHooks = useVeilLend(WSOL_MINT);
  const usdcHooks = useVeilLend(USDC_MINT);

  const handleViewChange = useCallback((nextView: 'MARKET' | 'PORTFOLIO') => {
    console.debug('[strict][ui] handleViewChange', {
      prevView: view,
      nextView,
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null,
      e2eEnabled
    });
    setView(nextView);
    if (!e2eEnabled || typeof window === 'undefined') return;
    window.scrollTo(0, 0);
  }, [e2eEnabled, view, walletAddress]);

  const normalizePrivacyNoteVault = useCallback((note: PrivacyNoteV2, vaultAddress: string) => {
    try {
      // Ensure vault address is valid base58 for note string encoding.
      new PublicKey(note.vaultAddress);
      return note;
    } catch {
      return { ...note, vaultAddress };
    }
  }, []);

  const buildNoteStringForSymbol = useCallback(
    (symbol: 'SOL' | 'USDC', noteHash: string) => {
      if (!walletAddress) return null;
      const hooks = symbol === 'SOL' ? solHooks : usdcHooks;
      const vaultAddress = hooks.vaultAddress?.toBase58();
      if (!vaultAddress) return null;
      const scopedNotes = getUnspentNotes(walletAddress, vaultAddress);
      const candidates = scopedNotes.length === 0 && e2eEnabled
        ? getUnspentNotes(walletAddress)
        : scopedNotes;
      const latest = candidates.slice(-1)[0];
      if (!latest) return null;
      const normalized = normalizePrivacyNoteVault(latest, vaultAddress);
      try {
        return buildNoteStringFromPrivacyNote(normalized, symbol, noteHash);
      } catch {
        return null;
      }
    },
    [e2eEnabled, normalizePrivacyNoteVault, solHooks, usdcHooks, walletAddress],
  );

  const e2ePlaceholderNote = `${NOTE_STRING_PREFIX}${'0'.repeat(64)}`;
  const draftNoteString = useMemo(() => {
    if (!draftNote) return e2eEnabled ? e2ePlaceholderNote : 'Note string unavailable';
    if (draftNote.noteString) return draftNote.noteString;
    // Try to build it now if vault is ready
    const noteString = buildNoteStringForSymbol('SOL', draftNote.noteHash);
    return noteString ?? (e2eEnabled ? e2ePlaceholderNote : 'Generating note...');
  }, [draftNote, buildNoteStringForSymbol, e2eEnabled, e2ePlaceholderNote]);

  const draftNoteReady = useMemo(
    () => Boolean(
      draftNote
        && draftNote.noteString
        && draftNote.noteString.startsWith(NOTE_STRING_PREFIX)
        && draftPrivacyNote,
    ),
    [draftNote, draftPrivacyNote],
  );

  const attachLatestNoteString = useCallback(
    (noteRecord: NoteRecord | null, symbol: 'SOL' | 'USDC') => {
      if (!noteRecord) return noteRecord;
      const noteString = buildNoteStringForSymbol(symbol, noteRecord.noteHash);
      if (!noteString) return noteRecord;
      return { ...noteRecord, noteString };
    },
    [buildNoteStringForSymbol],
  );

  const refreshAllNotes = useCallback(() => {
    solHooks.refreshNote();
    usdcHooks.refreshNote();
  }, [solHooks, usdcHooks]);

  const clearAllNotes = useCallback(() => {
    solHooks.clearNote();
    usdcHooks.clearNote();
  }, [solHooks, usdcHooks]);

  const readNoteAccessRecord = useCallback((noteHash: string): NoteAccessRecord | null => {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${NOTE_ACCESS_STORAGE_PREFIX}:${noteHash}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as NoteAccessRecord;
      if (parsed.noteHash !== noteHash) return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const writeNoteAccessRecord = useCallback(
    (noteRecord: NoteRecord) => {
      if (!walletAddress || typeof localStorage === 'undefined') return;
      const secrets = loadSecrets(walletAddress) ?? initializeSecrets(walletAddress);
      const secretsPayload = {
        blindingFactor: toHexBytes(secrets.blindingFactor),
        spendingKey: toHexBytes(secrets.spendingKey),
      };
      const privacyNotes = loadPrivacyNotes(walletAddress);
      const now = Date.now();
      const record: NoteAccessRecord = {
        version: 1,
        noteHash: noteRecord.noteHash,
        noteString: noteRecord.noteString,
        privacyNotes,
        secrets: secretsPayload,
        createdAt: noteRecord.createdAt ?? now,
        updatedAt: now,
      };
      localStorage.setItem(`${NOTE_ACCESS_STORAGE_PREFIX}:${noteRecord.noteHash}`, JSON.stringify(record));
    },
    [walletAddress],
  );

  const applyNoteAccessRecord = useCallback(
    (access: NoteAccessRecord, noteStringOverride?: string) => {
      if (!walletAddress) return;
      const noteString = noteStringOverride ?? access.noteString;
      const record: NoteRecord = {
        version: 1,
        walletAddress,
        noteHash: access.noteHash,
        noteString,
        createdAt: access.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      saveNoteRecord(record);
      if (Array.isArray(access.privacyNotes)) {
        savePrivacyNotes(walletAddress, access.privacyNotes);
      }
      if (access.secrets) {
        saveSecrets(walletAddress, access.secrets);
      }
      refreshAllNotes();
    },
    [refreshAllNotes, walletAddress],
  );

  const getHooks = useCallback(
    (action: ActionType | null, symbol: string) => {
      if (!action) return solHooks;

      if (action === 'SUPPLY' || action === 'WITHDRAW') {
        if (resolveSymbol(solHooks.collateralMint) === symbol) return solHooks;
        if (resolveSymbol(usdcHooks.collateralMint) === symbol) return usdcHooks;
      } else {
        if (resolveBorrowSymbol(solHooks.borrowMintAddress, solHooks.collateralMint) === symbol) return solHooks;
        if (resolveBorrowSymbol(usdcHooks.borrowMintAddress, usdcHooks.collateralMint) === symbol) return usdcHooks;
      }
      return solHooks;
    },
    [solHooks, usdcHooks]
  );

  const activeHooks = getHooks(activeAction, activeSymbol);

  const {
    cluster,
    note,
    walletBalanceLamports,
    collateralBalanceLamports,
    borrowBalanceLamports,
    usdcBalanceLamports,
    collateralDecimals,
    collateralMint,
    borrowCapacityLamports,
    programError,
    fastAdapter,
    secureAdapter,
    isMerkleTreeInitialized,
  } = activeHooks;

  const solPosition = solHooks.displayPosition ?? solHooks.myPosition;
  const usdcPosition = usdcHooks.displayPosition ?? usdcHooks.myPosition;

  const activePosition = activeHooks.displayPosition ?? activeHooks.myPosition;

  const unifiedMarketRows = useMemo(() => {
    const assets = ['SOL', 'USDC'];
    const fallback = { price: 0, supplyApy: 0, borrowApy: 0 };

    return assets.map(symbol => {
      const stats = MARKET_BASE[symbol as keyof typeof MARKET_BASE] ?? fallback;
      return {
        symbol,
        ...stats,
      };
    });
  }, []);

  const maxByAction = useCallback(
    (action: ActionType) => {
      const e2eUseRealMax =
        typeof window !== 'undefined'
          ? (window as Window & { __VEILLEND_E2E_USE_REAL_MAX__?: boolean })
              .__VEILLEND_E2E_USE_REAL_MAX__
          : false;
      if (e2eEnabled && !e2eUseRealMax) {
        return 10;
      }
      switch (action) {
        case 'SUPPLY':
          return toUiAmount(
            collateralMint.equals(WSOL_MINT)
              ? walletBalanceLamports
              : collateralBalanceLamports,
            collateralDecimals,
          );
        case 'WITHDRAW':
          return toUiAmount(activePosition?.deposit ?? 0, collateralDecimals);
        case 'BORROW':
          return toUiAmount(borrowCapacityLamports, decimalsForSymbol(activeSymbol));
        case 'REPAY':
          return toUiAmount(borrowBalanceLamports, decimalsForSymbol(activeSymbol));
        default:
          return 0;
      }
    },
    [
      e2eEnabled,
      activePosition,
      activeSymbol,
      borrowBalanceLamports,
      borrowCapacityLamports,
      collateralBalanceLamports,
      collateralDecimals,
      collateralMint,
      walletBalanceLamports,
    ],
  );

  const decimalsByAction = useCallback(
    (action: ActionType, symbol: string) =>
      action === 'BORROW' || action === 'REPAY'
        ? decimalsForSymbol(symbol)
        : collateralDecimals,
    [collateralDecimals],
  );

  const openAction = (action: ActionType, symbol: string) => {
    if (e2eEnabled && typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
    const nextHooks = getHooks(action, symbol);
    const nextMode: LendingMode = nextHooks.isMerkleTreeInitialized ? 'SECURE' : 'FAST';
    console.warn('[strict][ui] openAction', {
      action,
      symbol,
      nextMode,
      isMerkleTreeInitialized: nextHooks.isMerkleTreeInitialized,
      hasNote: Boolean(note),
      noteHashPrefix: note?.noteHash ? note.noteHash.slice(0, 8) : null,
      noteStringPrefix: note?.noteString ? note.noteString.slice(0, 20) : null,
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null,
      buttonWillBeDisabled: nextMode === 'SECURE' && !note,
    });
    setActiveAction(action);
    setActiveSymbol(symbol);
    setAmount('');
    setMode(nextMode);
    setActionError(null);
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
    setActionSuccess(null);
    setSuccessNote(null);
    setSuccessProof(null);
  };

  const closeAction = () => {
    console.debug('[strict][ui] closeAction', {
      action: activeAction,
      symbol: activeSymbol,
      wasBusy: actionBusy
    });
    setActiveAction(null);
    setAmount('');
    setActionError(null);
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
  };

  const showMerkleInit = mode === 'SECURE' && !isMerkleTreeInitialized;

  const handleConfirm = async () => {
    if (!activeAction) return;
    console.debug('[strict][ui] handleConfirm start', {
      mode,
      action: activeAction,
      symbol: activeSymbol,
      amountUi: amount,
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null,
      noteHashPrefix: note?.noteHash ? note.noteHash.slice(0, 8) : null,
    });
    if (!walletAddress) {
      setActionError('Connect wallet to continue.');
      return;
    }

    const decimals = decimalsByAction(activeAction, activeSymbol);
    const lamports = parseAmount(amount, decimals);
    if (!lamports) {
      setActionError('Enter a valid amount.');
      return;
    }

    const maxAmount = maxByAction(activeAction);
    const maxLamports = Math.floor(maxAmount * Math.pow(10, decimals));
    if (lamports > maxLamports) {
      const formattedMax = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(maxAmount);
      setActionError(`Amount exceeds maximum of ${formattedMax}.`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    setActionMessage(
      mode === 'SECURE'
        ? 'Generating proof and submitting transaction...'
        : 'Submitting action...'
    );
    setProof(null);
    setPendingNote(null);
    setNoteSaved(false);
    setActionSuccess(null);
    setSuccessNote(null);
    setSuccessProof(null);
    const actionLabel = activeAction.toLowerCase();
    let nextNote: NoteRecord | null = null;
    let proofResult: ZkProofResult | null = null;

    try {
      let signature = '';
      const adapter = mode === 'SECURE' ? secureAdapter : fastAdapter;
      switch (activeAction) {
        case 'SUPPLY':
          {
            const result = await adapter.supply(lamports);
            signature = result.signature;
            proofResult = result.proof ?? null;
            console.debug('[strict][ui] supply submitted', {
              signature: signature.slice(0, 10) + '...',
              hasProof: Boolean(proofResult),
              mode
            });
          }
          break;
        case 'BORROW':
          {
            const result = await adapter.borrow(lamports);
            signature = result.signature;
            proofResult = result.proof ?? null;
            console.debug('[strict][ui] borrow submitted', {
              signature: signature.slice(0, 10) + '...',
              hasProof: Boolean(proofResult),
              mode
            });
          }
          break;
        case 'REPAY':
          {
            const result = await adapter.repay(lamports);
            signature = result.signature;
            proofResult = result.proof ?? null;
            console.debug('[strict][ui] repay submitted', {
              signature: signature.slice(0, 10) + '...',
              hasProof: Boolean(proofResult),
              mode
            });
          }
          break;
        case 'WITHDRAW':
          {
            const result = await adapter.withdraw(lamports);
            signature = result.signature;
            proofResult = result.proof ?? null;
            console.debug('[strict][ui] withdraw submitted', {
              signature: signature.slice(0, 10) + '...',
              hasProof: Boolean(proofResult),
              mode
            });
          }
          break;
        default:
          break;
      }

      if (mode === 'SECURE') {
        if (!note) {
          setActionError('Import or create a note access key before using secure mode.');
          return;
        }
        setActionMessage('Rotating note...');
        const baseNote = note;
        nextNote = await rotateNoteRecord(walletAddress, signature, baseNote);
        setProof(proofResult);
        setPendingNote(nextNote);
      } else {
        closeAction();
      }

      showActionSuccess(`${actionLabel} completed successfully.`, mode === 'SECURE' && Boolean(nextNote));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : typeof error;
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[strict][ui] handleConfirm error', {
        action: activeAction,
        mode,
        message: errorMessage,
        name: errorName,
        stack: errorStack,
      });
      setActionError(parseTransactionError(error));
    } finally {
      setActionBusy(false);
      setActionMessage('');
    }
  };

  const handleSaveNote = async () => {
    if (!pendingNote) return;
    console.debug('[strict][ui] handleSaveNote', {
      noteHashPrefix: pendingNote.noteHash ? pendingNote.noteHash.slice(0, 8) : null,
      hasNoteString: Boolean(pendingNote.noteString),
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null
    });
    const resolved = attachLatestNoteString(pendingNote, activeSymbol as 'SOL' | 'USDC') ?? pendingNote;
    saveNoteRecord(resolved);
    writeNoteAccessRecord(resolved);
    await copyNoteString(resolved);
    refreshAllNotes();
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 3000);
    closeAction();
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

  const handleSaveSuccessNote = async () => {
    if (!successNote) return;
    const resolved = attachLatestNoteString(successNote, activeSymbol as 'SOL' | 'USDC') ?? successNote;
    saveNoteRecord(resolved);
    writeNoteAccessRecord(resolved);
    await copyNoteString(resolved);
    refreshAllNotes();
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 3000);
    dismissActionSuccess();
  };

  const showPageError = (message: string) => {
    setPageError(message);
    window.setTimeout(() => setPageError(null), 4000);
  };

  const handleImportNote = async () => {
    if (!walletAddress) {
      showPageError('Connect wallet to import a note.');
      return;
    }
    if (!importNoteHash) {
      showPageError('Paste the note string to import.');
      return;
    }
    const rawInput = importNoteHash.trim();
    const normalizedInput = rawInput.replace(/\s+/g, '');
    const hasPrefix = normalizedInput.startsWith(NOTE_STRING_PREFIX);
    const looksLikeHash = isNoteHash(normalizedInput);
    if (!hasPrefix && !looksLikeHash) {
      showPageError('Invalid note string.');
      return;
    }

    if (looksLikeHash && !hasPrefix) {
      const access = readNoteAccessRecord(normalizedInput);
      if (!access) {
        showPageError('Invalid note string.');
        return;
      }
      applyNoteAccessRecord(access);
      setImportNoteHash('');
      showActionSuccess('Access restored.');
      setView('PORTFOLIO');
      return;
    }

    let payload: ReturnType<typeof decodeNoteString>;
    try {
      payload = decodeNoteString(normalizedInput);
    } catch (error) {
      console.error('Note string decode failed', error);
      showPageError('Invalid note string.');
      return;
    }

    const access = readNoteAccessRecord(payload.noteHash);
    if (access) {
      applyNoteAccessRecord(access, normalizedInput);
      setImportNoteHash('');
      showActionSuccess('Access restored.');
      setView('PORTFOLIO');
      return;
    }

    const solVault = solHooks.vaultAddress?.toBase58();
    const usdcVault = usdcHooks.vaultAddress?.toBase58();
    let symbol: 'SOL' | 'USDC' | null = null;
    if (payload.vaultAddress === solVault) symbol = 'SOL';
    if (payload.vaultAddress === usdcVault) symbol = 'USDC';
    if (!symbol && e2eEnabled) {
      symbol = 'SOL';
    }
    if (!symbol) {
      showPageError('Note vault does not match the available vaults.');
      return;
    }

    const ownerPubkey = publicKey?.toBytes() ?? new Uint8Array(32);
    const privacyNote = await buildPrivacyNoteFromNoteString({
      noteString: normalizedInput,
      walletAddress,
      ownerPubkey,
      collateralSymbol: symbol,
    });
    const existingNotes = getUnspentNotes(walletAddress).filter(
      (noteItem) => noteItem.vaultAddress !== payload.vaultAddress,
    );
    savePrivacyNotes(walletAddress, [...existingNotes, privacyNote]);

    const record: NoteRecord = {
      version: 1,
      walletAddress,
      noteHash: payload.noteHash,
      noteString: normalizedInput,
      createdAt: Number(payload.timestamp),
      updatedAt: Date.now(),
    };
    saveNoteRecord(record);
    refreshAllNotes();
    setImportNoteHash('');
    showActionSuccess('Access restored.');
    setView('PORTFOLIO');
  };

  const handleCreateInitialNote = async () => {
    console.warn('[strict][ui] handleCreateInitialNote start', {
      walletAddress,
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null,
      hasPublicKey: Boolean(publicKey),
      publicKeyBase58: publicKey?.toBase58()?.slice(0, 8) ?? null,
    });
    if (!walletAddress) {
      showPageError('Connect wallet to create a note.');
      return;
    }
    const vaultAddress = solHooks.vaultAddress?.toBase58();
    if (!vaultAddress) {
      showPageError('Vault is still initializing. Please try again in a moment.');
      return;
    }
    setDraftNote(null);
    setDraftPrivacyNote(null);
    try {
      const record = await createInitialNoteRecord(walletAddress);
      const noteIndex = getNextNoteIndex(walletAddress);
      const privacyNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey: publicKey?.toBytes() ?? new Uint8Array(32),
        vaultAddress,
        depositAmount: 0n,
        borrowAmount: 0n,
        noteIndex,
        collateralSymbol: 'SOL',
      });
      const noteString = buildNoteStringFromPrivacyNote(privacyNote, 'SOL', record.noteHash);
      console.warn('[strict][ui] handleCreateInitialNote created', {
        noteHashPrefix: record.noteHash.slice(0, 8),
        noteStringPrefix: noteString.slice(0, 20),
        walletAddress,
      });
      setDraftPrivacyNote(privacyNote);
      setDraftNote({ ...record, noteString });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[strict][ui] handleCreateInitialNote error', { message });
      showPageError(message);
    }
  };

  const handleSaveDraftNote = async () => {
    console.warn('[strict][ui] handleSaveDraftNote start', {
      hasDraftNote: Boolean(draftNote),
      draftNoteReady,
      walletAddress,
      walletPrefix: walletAddress ? toShortHash(walletAddress, 4) : null,
      noteHashPrefix: draftNote?.noteHash?.slice(0, 8) ?? null,
    });
    if (!draftNote || !draftNoteReady || !walletAddress) {
      console.warn('[strict][ui] handleSaveDraftNote early exit', {
        reason: !draftNote ? 'no draftNote' : !draftNoteReady ? 'draftNoteReady=false' : 'no walletAddress',
      });
      return;
    }
    if (draftPrivacyNote) {
      savePrivacyNote(walletAddress, draftPrivacyNote);
    }
    saveNoteRecord(draftNote);
    console.warn('[strict][ui] handleSaveDraftNote saved', {
      storageKey: `veillend.note:${draftNote.walletAddress}`,
      noteHashPrefix: draftNote.noteHash.slice(0, 8),
    });
    writeNoteAccessRecord(draftNote);
    await copyNoteString(draftNote);
    refreshAllNotes();
    console.warn('[strict][ui] handleSaveDraftNote refreshed notes');
    setDraftNote(null);
    setDraftPrivacyNote(null);
    showActionSuccess('Note created and saved successfully.');
    setView('PORTFOLIO');
  };

  const handleSeedVault = async () => {
    if (!publicKey) {
      showPageError('Connect wallet to seed the vault.');
      return;
    }
    if (!usdcHooks.vaultStats) {
      showPageError('Vault is not initialized yet.');
      return;
    }
    setSeedBusy(true);
    setSeedError(null);
    try {
      await usdcHooks.fastAdapter.supply(seedAmountLamports);
      showActionSuccess('Seeded vault with 1,000 USDC.');
    } catch (error) {
      setSeedError(parseTransactionError(error));
    } finally {
      setSeedBusy(false);
    }
  };

  const usdcVaultCollateral = usdcHooks.vaultStats?.totalCollateral ?? 0;
  const healthFactor = activePosition?.healthFactor ?? 0;
  const seedAmountLamports = Math.floor(1000 * Math.pow(10, usdcHooks.collateralDecimals));
  const seedReady = usdcHooks.collateralBalanceLamports >= seedAmountLamports;
  const showSeedVault = Boolean(usdcHooks.vaultStats) && usdcVaultCollateral === 0;

  return (
    <Layout activeView={view} onViewChange={handleViewChange} clusterLabel={cluster.toUpperCase()}>
      <div className={`space-y-8 ${e2eEnabled ? '' : 'animate-fade-up'}`}>
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
                {formatAmount(solHooks.vaultStats?.totalCollateral ?? 0, 9)} SOL
              </p>
              <p className="text-sm text-slate-400">
                {formatAmount(usdcHooks.vaultStats?.totalCollateral ?? 0, 6)} USDC
              </p>
            </div>
            {showSeedVault && (
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleSeedVault}
                  disabled={!seedReady || seedBusy}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {seedBusy ? 'Seeding vault...' : 'Seed 1,000 USDC'}
                </button>
                {!seedReady && (
                  <p className="text-[10px] text-slate-400">
                    Mint at least 1,000 USDC to your wallet to seed the vault.
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
              ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
                (toUiAmount(solHooks.vaultStats?.totalCollateral ?? 0, 9) * MARKET_BASE.SOL.price) +
                (toUiAmount(usdcHooks.vaultStats?.totalCollateral ?? 0, 6) * MARKET_BASE.USDC.price)
              )}
            </p>
          </div>
          <div className="glass p-6 rounded-3xl border-white/10">
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">
              Vault Borrowed
            </p>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-red-300">
                {formatAmount(solHooks.vaultStats?.totalBorrowed ?? 0, 6)} USDC
              </p>
              <p className="text-sm text-red-300/60">
                {formatAmount(usdcHooks.vaultStats?.totalBorrowed ?? 0, 9)} SOL
              </p>
            </div>
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
                    {unifiedMarketRows.map((market) => (
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
                  <div className="glass rounded-3xl overflow-hidden border-white/10 relative group">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 opacity-50" />
                    
                    <div className="relative p-8 md:p-12 text-center space-y-8">
                      <div className="space-y-4">
                        <div className="w-20 h-20 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center shadow-inner relative overflow-hidden">
                          <div className="absolute inset-0 bg-emerald-500/10 blur-xl animate-pulse" />
                          <svg className="w-8 h-8 text-emerald-400 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-white mb-2">Private Vault Access</h2>
                          <p className="text-slate-400 max-w-md mx-auto">
                Your financial data is encrypted. Paste your note string to unlock your position or initialize a new shielded identity.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                        <div className="p-6 rounded-2xl bg-black/20 border border-white/5 hover:border-white/10 transition-colors text-left space-y-4">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-white/5 text-slate-300">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                              </svg>
                            </div>
                            <h3 className="font-bold text-slate-200">Import Existing Note</h3>
                          </div>
                          <div className="space-y-3">
                            <input
                              type="text"
                              value={importNoteHash}
                              onChange={(event) => setImportNoteHash(event.target.value)}
                              placeholder="Paste note string..."
                              className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors font-mono"
                            />
                            <button
                              type="button"
                              onClick={handleImportNote}
                              className="w-full py-3 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 text-white transition-all border border-white/5"
                            >
                              Unlock Vault
                            </button>
                          </div>
                        </div>

                        <div className="p-6 rounded-2xl bg-emerald-900/10 border border-emerald-500/20 hover:border-emerald-500/30 transition-colors text-left space-y-4 relative overflow-hidden">
                          <div className="flex items-center gap-3 mb-2 relative z-10">
                            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <h3 className="font-bold text-emerald-100">Initialize New Identity</h3>
                          </div>
                          
                          {!draftNote ? (
                            <div className="space-y-4 relative z-10">
                              <p className="text-sm text-emerald-200/60 leading-relaxed">
                                Generate a cryptographically secure note to start your private lending journey. This note is your only key.
                              </p>
                              <button
                                type="button"
                                onClick={handleCreateInitialNote}
                                className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-900/20"
                              >
                                Generate Access Key
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3 relative z-10">
                              <div className="p-3 bg-black/40 rounded-xl border border-emerald-500/20">
                                <p className="text-[10px] uppercase tracking-widest text-emerald-500/70 font-bold mb-2">
                                  Note Access Hash
                                </p>
                                <code
                                  className="text-xs font-mono text-emerald-200 break-all block leading-relaxed"
                                  data-snapshot="dynamic"
                                  data-testid="note-access-hash"
                                >
                                  {draftNote?.noteHash ?? 'Unavailable'}
                                </code>
                              </div>
                              <div className="p-3 bg-black/40 rounded-xl border border-emerald-500/20">
                                <p className="text-[10px] uppercase tracking-widest text-emerald-500/70 font-bold mb-2">
                                  Note String
                                </p>
                                <code
                                  className="text-xs font-mono text-emerald-300 break-all block leading-relaxed"
                                  data-snapshot="dynamic"
                                  data-testid="note-string"
                                >
                                  {draftNoteString}
                                </code>
                              </div>
                              <button
                                type="button"
                                onClick={handleSaveDraftNote}
                                disabled={!draftNoteReady}
                                className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-emerald-500"
                              >
                                Copy & Save
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <SavedNotes />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="glass rounded-3xl border-white/10 overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/5 bg-white/[0.02] flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-sm font-bold tracking-wide text-slate-200">VAULT UNLOCKED</span>
                          <span
                            className="text-xs font-mono text-slate-500 px-2 py-0.5 bg-white/5 rounded"
                            data-snapshot="dynamic"
                          >
                    {note.noteString ? toShortHash(note.noteString, 8) : 'No note string'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={clearAllNotes}
                          className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-2 transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Lock Vault
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">
                        <div className="p-8 space-y-6 relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-32 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/10 transition-colors" />
                          
                          <div className="relative z-10">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Collateral Assets</p>
                            <div className="space-y-2">
                              <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">
                                  {formatAmount(solPosition?.deposit ?? 0, 9)}
                                </span>
                                <span className="text-lg font-medium text-emerald-400">SOL</span>
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">
                                  {formatAmount(usdcPosition?.deposit ?? 0, 6)}
                                </span>
                                <span className="text-lg font-medium text-emerald-400">USDC</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3 relative z-10 pt-4">
                            <button
                              type="button"
                              onClick={() => openAction('SUPPLY', 'SOL')}
                              className="flex-1 py-3 px-4 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Deposit SOL
                            </button>
                            <button
                              type="button"
                              onClick={() => openAction('WITHDRAW', 'SOL')}
                              className="flex-1 py-3 px-4 rounded-xl bg-white/5 text-white font-bold text-sm hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2"
                            >
                              Withdraw
                            </button>
                          </div>
                        </div>

                        <div className="p-8 space-y-6 relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-32 bg-red-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-red-500/10 transition-colors" />

                          <div className="relative z-10">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Outstanding Debt</p>
                            <div className="space-y-2">
                              <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">
                                  {formatAmount(solPosition?.borrow ?? 0, 6)}
                                </span>
                                <span className="text-lg font-medium text-red-300">USDC</span>
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-white">
                                  {formatAmount(usdcPosition?.borrow ?? 0, 9)}
                                </span>
                                <span className="text-lg font-medium text-red-300">SOL</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3 relative z-10 pt-4">
                            <button
                              type="button"
                              onClick={() => openAction('BORROW', 'USDC')}
                              className="flex-1 py-3 px-4 rounded-xl bg-white/5 text-white font-bold text-sm hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                              Borrow USDC
                            </button>
                            <button
                              type="button"
                              onClick={() => openAction('REPAY', 'USDC')}
                              className="flex-1 py-3 px-4 rounded-xl bg-white/5 text-white font-bold text-sm hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2"
                            >
                              Repay
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-4 bg-black/20 border-t border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                        <div className="flex items-center gap-4">
                          <span data-snapshot="dynamic">
                            Updated: {new Date(note.updatedAt).toLocaleString()}
                          </span>
                          <span className="hidden md:inline text-white/10">|</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${healthFactor > 1.2 ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className={healthFactor > 1.2 ? 'text-emerald-500' : 'text-red-500'}>
                            Health Factor: {healthFactor.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <section className="glass rounded-3xl p-5 border-cyan-500/30 bg-gradient-to-br from-cyan-500/[0.08] to-blue-500/[0.04]">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
                      {formatAmount(solPosition?.deposit ?? 0, 9, 4)} SOL
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Deposited</span>
                    <span className="font-bold font-mono text-emerald-300">
                      {formatAmount(usdcPosition?.deposit ?? 0, 6, 2)} USDC
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Borrowed</span>
                    <span className="font-bold font-mono text-red-300">
                      {formatAmount(solPosition?.borrow ?? 0, 6, 2)} USDC
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Borrowed</span>
                    <span className="font-bold font-mono text-red-300">
                      {formatAmount(usdcPosition?.borrow ?? 0, 9, 4)} SOL
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
        showMerkleInit={showMerkleInit}
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
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {successNote && successProof && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-100/80 font-bold mb-1">
                  Proof signals
                </p>
                <p className="font-mono break-all text-emerald-100" data-snapshot="dynamic">
                  {successProof.publicSignals.join(', ')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-100/80 font-bold mb-1">
                  New note
                </p>
                <p className="font-mono break-all text-emerald-100" data-snapshot="dynamic">
                    {successNote.noteString ?? 'Note string unavailable'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveSuccessNote}
                className="w-full rounded-lg border border-emerald-300/40 bg-emerald-500/30 px-3 py-2 text-[11px] font-bold text-emerald-50 hover:bg-emerald-500/40"
              >
                Save to storage & clipboard
              </button>
            </div>
          )}
        </div>
      )}

      {noteSaved && (
        <div
          className="fixed bottom-20 right-6 bg-emerald-500/10 border border-emerald-400/30 text-emerald-100 px-4 py-2 rounded-full text-xs"
          data-snapshot="dynamic"
          aria-live="polite"
        >
          Note saved to storage & clipboard.
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
