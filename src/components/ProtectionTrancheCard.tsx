import React from 'react';

export interface ProtectionTranche {
  id: string;
  name: string;
  triggerLtv: number;
  coverageLimit: number;
  fee: number;
  tier: number;
}

interface Props {
  tranche: ProtectionTranche;
  onPurchase: (tranche: ProtectionTranche) => void;
}

export const ProtectionTrancheCard: React.FC<Props> = ({ tranche, onPurchase }) => {
  return (
    <div className="glass p-6 rounded-2xl flex flex-col gap-4 border-l-4 border-l-cyan-400/80">
      <div className="flex justify-between items-start">
        <h3 className="font-bold text-lg">{tranche.name}</h3>
        <span className="text-xs text-slate-300 px-2 py-1 bg-white/5 rounded">
          30 Days
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-300">Trigger LTV</span>
          <span className="font-medium">{(tranche.triggerLtv * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-300">Coverage</span>
          <span className="font-medium">{tranche.coverageLimit.toLocaleString()} USDC</span>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
        <div>
          <span className="text-xl font-bold">{tranche.fee}</span>
          <span className="text-xs text-slate-300 ml-1">USDC</span>
        </div>
        <button
          type="button"
          onClick={() => onPurchase(tranche)}
          className="bg-cyan-500 hover:bg-cyan-400 px-4 py-2 rounded-xl text-sm font-bold transition-all"
        >
          Purchase
        </button>
      </div>
    </div>
  );
};
