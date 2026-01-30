import React, { useEffect } from 'react';
import { LendingMode } from '../sdk/adapter';
import { NoteRecord } from '../sdk/notes';
import type { ZkProofResult } from '../sdk/zkProof';

export type ActionType = 'SUPPLY' | 'BORROW' | 'REPAY' | 'WITHDRAW';

interface ActionModalProps {
  open: boolean;
  action: ActionType;
  assetSymbol: string;
  amount: string;
  maxAmount: number;
  mode: LendingMode;
  busy: boolean;
  error?: string | null;
  note?: NoteRecord | null;
  pendingNote?: NoteRecord | null;
  proof?: ZkProofResult | null;
  onAmountChange: (value: string) => void;
  onModeChange: (mode: LendingMode) => void;
  onConfirm: () => void;
  onClose: () => void;
  onSaveNote?: () => void;
  onMaxClick?: () => void;
  showMerkleInit?: boolean;
}

const modeCopy = (mode: LendingMode) =>
  mode === 'SECURE'
    ? {
        title: 'Shielded Privacy',
        detail: 'Generate local proof and rotate the note.',
      }
    : {
        title: 'Fast Execution',
        detail: 'Route directly with no privacy overhead.',
      };

export const ActionModal: React.FC<ActionModalProps> = ({
  open,
  action,
  assetSymbol,
  amount,
  maxAmount,
  mode,
  busy,
  error,
  note,
  pendingNote,
  proof,
  onAmountChange,
  onModeChange,
  onConfirm,
  onClose,
  onSaveNote,
  onMaxClick,
  showMerkleInit,
}) => {
  const modeText = modeCopy(mode);
  const titleId = 'action-modal-title';
  const descriptionId = 'action-modal-description';

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-lg z-[110] flex items-center justify-center p-4">
      <div
        className="glass w-full max-w-md rounded-[32px] p-8 border-white/10 shadow-2xl relative animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <p id={descriptionId} className="sr-only">
          {`Review and confirm your ${action.toLowerCase()} ${assetSymbol} action in ${modeText.title} mode.`}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="absolute top-6 right-6 text-slate-500 hover:text-white"
        >
          <span className="sr-only">Close</span>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-[18px] bg-slate-800 flex items-center justify-center text-xl font-bold border border-white/10">
            {assetSymbol[0]}
          </div>
          <div>
            <h2 id={titleId} className="text-2xl font-bold capitalize">
              {action.toLowerCase()} {assetSymbol}
            </h2>
            <p className="text-xs text-slate-500">VeilLend Broker Layer</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
              <label htmlFor="amount">Amount</label>
              <button
                type="button"
                className="text-emerald-300 hover:text-emerald-200"
                onClick={onMaxClick}
              >
                Max {maxAmount.toFixed(4)}
              </button>
            </div>
            <div className="relative">
              <input
                id="amount"
                type="number"
                value={amount}
                onChange={(event) => onAmountChange(event.target.value)}
                placeholder="0.00"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-xl font-bold focus:outline-none focus:border-cyan-400/50 transition-all"
              />
              <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-slate-500">
                {assetSymbol}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">{modeText.title}</p>
              <p className="text-[10px] text-slate-300">{modeText.detail}</p>
            </div>
            <button
              type="button"
              aria-label="Toggle mode"
              onClick={() => onModeChange(mode === 'SECURE' ? 'FAST' : 'SECURE')}
              className={`w-12 h-6 rounded-full transition-all relative ${
                mode === 'SECURE' ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                  mode === 'SECURE' ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          {mode === 'SECURE' && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-xs space-y-2">
              <div className="flex justify-between text-slate-300">
                <span>Active note</span>
                <span className="text-slate-300" data-snapshot="dynamic">
                  {note?.noteString ? `${note.noteString.slice(0, 12)}...` : 'None'}
                </span>
              </div>
            </div>
          )}

          {showMerkleInit && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-3 animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="text-amber-400 mt-0.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-amber-200">Merkle Tree Missing</p>
                  <p className="text-amber-200/70 leading-relaxed">
                    The privacy tree will initialize automatically on your first shielded action. No manual activation is
                    required.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {proof && pendingNote && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-xs space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-300 font-bold mb-2">
                  Proof signals
                </p>
                <p className="font-mono text-emerald-300 break-all" data-snapshot="dynamic">
                  {proof.publicSignals.join(', ')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-300 font-bold mb-2">
                  New note
                </p>
                <p className="font-mono text-cyan-300 break-all" data-snapshot="dynamic">
                  {pendingNote.noteString ?? 'Note string unavailable'}
                </p>
              </div>
              {onSaveNote && (
                <button
                  type="button"
                  onClick={onSaveNote}
                  className="w-full py-2 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30 transition-all"
                >
                  Save to storage & clipboard
                </button>
              )}
            </div>
          )}

          {mode === 'SECURE' && !note && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-2">
               <p className="font-bold text-amber-200">No Active Note</p>
               <p className="text-amber-200/70">
                 You need an active privacy note to perform shielded actions.
                 Please import or create a note in your portfolio first. Without a note, shielded transactions cannot be
                 recorded to your private ledger later.
               </p>
            </div>
          )}

          <button
            type="button"
            onClick={onConfirm}
            disabled={!amount || busy || (mode === 'SECURE' && !note)}
            className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
              mode === 'SECURE'
                ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-900 shadow-lg shadow-emerald-500/20'
                : 'bg-white text-slate-900'
            } ${(!amount || busy || (mode === 'SECURE' && !note)) && 'opacity-50 cursor-not-allowed'}`}
          >
            {busy ? 'Working...' : mode === 'SECURE' ? 'Shield and Execute' : 'Execute'}
          </button>
        </div>
      </div>
    </div>
  );
};
