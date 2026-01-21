import React from 'react';

interface RiskIndicatorProps {
  health: number;
  label: string;
}

export const RiskIndicator: React.FC<RiskIndicatorProps> = ({ health, label }) => {
  const getStatusColor = (value: number) => {
    if (value > 2) return 'text-emerald-400 bg-emerald-400/10';
    if (value > 1.5) return 'text-yellow-400 bg-yellow-400/10';
    return 'text-red-400 bg-red-400/10';
  };

  const getPercentage = () => Math.min(100, Math.max(0, (health - 1) * 50));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-end">
        <span className="text-sm text-slate-300 uppercase tracking-wider">{label}</span>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(health)}`}>
          HF: {health.toFixed(2)}
        </span>
      </div>
      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-emerald-400 transition-all duration-500"
          style={{ width: `${getPercentage()}%` }}
        />
      </div>
    </div>
  );
};
