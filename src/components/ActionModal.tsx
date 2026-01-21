import React from 'react';
import { LendingMode } from '../sdk/adapter';
import { NoteRecord } from '../sdk/notes';
import { ProofArtifact } from '../sdk/proof';

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
  proof?: ProofArtifact | null;
  onAmountChange: (value: string) => void;
  onModeChange: (mode: LendingMode) => void;
  onConfirm: () => void;
  onClose: () => void;
  onSaveNote?: () => void;
  onMaxClick?: () => void;
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
}) => {
  if (!open) return null;
  const modeText = modeCopy(mode);

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-lg z-[110] flex items-center justify-center p-4">
      <div className="glass w-full max-w-md rounded-[32px] p-8 border-white/10 shadow-2xl relative animate-fade-up">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-6 right-6 text-slate-500 hover:text-white"
        >
          <span className="sr-only">Close</span>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-[18px] bg-slate-800 flex items-center justify-center text-xl font-bold border border-white/10">
            {assetSymbol[0]}
          </div>
          <div>
            <h2 className="text-2xl font-bold capitalize">
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
                <span className="text-slate-300">
                  {note ? `${note.noteHash.slice(0, 12)}...` : 'None'}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Last tx id</span>
                <span className="text-slate-300">
                  {note ? note.lastTxnId.slice(0, 10) : '0'}
                </span>
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
                  Proof artifact
                </p>
                <p className="font-mono text-emerald-300 break-all">{proof.proofHash}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-300 font-bold mb-2">
                  Next note
                </p>
                <p className="font-mono text-cyan-300 break-all">{pendingNote.noteHash}</p>
              </div>
              {onSaveNote && (
                <button
                  type="button"
                  onClick={onSaveNote}
                  className="w-full py-2 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30 transition-all"
                >
                  Save to storage
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onConfirm}
            disabled={!amount || busy}
            className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
              mode === 'SECURE'
                ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-900 shadow-lg shadow-emerald-500/20'
                : 'bg-white text-slate-900'
            } ${(!amount || busy) && 'opacity-50 cursor-not-allowed'}`}
          >
            {busy ? 'Working...' : mode === 'SECURE' ? 'Shield and Execute' : 'Execute'}
          </button>
        </div>
      </div>
    </div>
  );
};
