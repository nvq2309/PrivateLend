import { FC, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useVeilLend } from '../hooks/useVeilLend';

interface ProtectionTier {
  id: 0 | 1 | 2;
  name: string;
  coverage: string;
  threshold: string;
  rate: string;
  color: string;
}

const tiers: ProtectionTier[] = [
  {
    id: 0,
    name: 'No Protection',
    coverage: '0%',
    threshold: 'N/A',
    rate: '0%',
    color: 'gray',
  },
  {
    id: 1,
    name: 'Basic',
    coverage: '5%',
    threshold: '115%',
    rate: '0.5%',
    color: 'blue',
  },
  {
    id: 2,
    name: 'Premium',
    coverage: '10%',
    threshold: '105%',
    rate: '1.0%',
    color: 'purple',
  },
];

export const ProtectionCard: FC = () => {
  const { publicKey } = useWallet();
  const { myPosition, subscribeProtection, isLoading: hookLoading } = useVeilLend();
  const [selectedTier, setSelectedTier] = useState<0 | 1 | 2>(0);
  const [duration, setDuration] = useState(30);
  const [isSubscribing, setIsSubscribing] = useState(false);

  const calculatePremium = useMemo(() => {
    if (!myPosition || selectedTier === 0) return 0;
    const rate = selectedTier === 1 ? 0.005 : 0.01;
    return (myPosition.deposit / 1e9) * rate * (duration / 30);
  }, [myPosition, selectedTier, duration]);

  const coverageAmount = useMemo(() => {
    if (!myPosition) return 0;
    const coveragePercent = selectedTier === 1 ? 0.05 : selectedTier === 2 ? 0.1 : 0;
    return (myPosition.deposit / 1e9) * coveragePercent;
  }, [myPosition, selectedTier]);

  const handleSubscribe = async () => {
    if (!publicKey || selectedTier === 0) return;
    
    setIsSubscribing(true);
    try {
      await subscribeProtection(selectedTier, duration);
    } catch (error) {
      console.error('Failed to subscribe:', error);
    } finally {
      setIsSubscribing(false);
    }
  };

  const getTierButtonClass = (tier: ProtectionTier) => {
    const isSelected = selectedTier === tier.id;
    const baseClass = 'p-4 rounded-xl border-2 transition-all duration-200 text-left';
    
    if (isSelected) {
      if (tier.id === 0) return `${baseClass} border-gray-500 bg-gray-700/50`;
      if (tier.id === 1) return `${baseClass} border-blue-500 bg-blue-500/20 shadow-lg shadow-blue-500/20`;
      return `${baseClass} border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/20`;
    }
    return `${baseClass} border-gray-700 hover:border-gray-600 bg-gray-800/30`;
  };

  const formatDuration = (days: number) => {
    if (days < 30) return `${days} days`;
    if (days < 365) return `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''}`;
    return '1 year';
  };

  return (
    <div className="bg-gradient-to-br from-gray-800/60 to-gray-900/60 backdrop-blur-xl rounded-2xl border border-gray-700/50 p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <span className="text-2xl">🛡️</span>
          Liquidation Protection
        </h3>
        <span className="text-green-400 text-xs px-3 py-1 bg-green-500/20 rounded-full border border-green-500/30 font-medium">
          Real On-Chain
        </span>
      </div>
      
      <p className="text-gray-400 text-sm mb-6 leading-relaxed">
        Protect your position from liquidation. When your health factor drops below the threshold, 
        collateral is automatically added from the reserve pool to restore your position.
      </p>
      
      <div className="grid grid-cols-3 gap-3 mb-6">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            onClick={() => setSelectedTier(tier.id)}
            className={getTierButtonClass(tier)}
          >
            <p className="text-white font-semibold text-sm mb-2">{tier.name}</p>
            <div className="space-y-1">
              <p className="text-gray-400 text-xs flex justify-between">
                <span>Coverage:</span>
                <span className="text-white">{tier.coverage}</span>
              </p>
              <p className="text-gray-400 text-xs flex justify-between">
                <span>Trigger:</span>
                <span className={tier.id === 2 ? 'text-yellow-400' : tier.id === 1 ? 'text-blue-400' : 'text-gray-500'}>
                  {tier.threshold}
                </span>
              </p>
              <p className="text-gray-400 text-xs flex justify-between">
                <span>Rate:</span>
                <span className="text-white">{tier.rate}/mo</span>
              </p>
            </div>
          </button>
        ))}
      </div>
      
      {selectedTier > 0 && (
        <>
          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <label className="text-gray-400 text-sm">Protection Duration</label>
              <span className="text-white font-medium">{formatDuration(duration)}</span>
            </div>
            <input
              type="range"
              min={7}
              max={365}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider-thumb"
              style={{
                background: `linear-gradient(to right, ${selectedTier === 1 ? '#3b82f6' : '#8b5cf6'} 0%, ${selectedTier === 1 ? '#3b82f6' : '#8b5cf6'} ${((duration - 7) / (365 - 7)) * 100}%, #374151 ${((duration - 7) / (365 - 7)) * 100}%, #374151 100%)`
              }}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>7 days</span>
              <span>6 months</span>
              <span>1 year</span>
            </div>
          </div>
          
          <div className="bg-gray-900/50 rounded-xl p-4 mb-6 border border-gray-700/50">
            <h4 className="text-sm font-medium text-gray-300 mb-3">Protection Summary</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm">Premium Cost</span>
                <span className="text-white font-medium">{calculatePremium.toFixed(6)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm">Max Coverage</span>
                <span className="text-white font-medium">{coverageAmount.toFixed(4)} SOL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm">Protection Trigger</span>
                <span className={`font-medium ${selectedTier === 1 ? 'text-blue-400' : 'text-purple-400'}`}>
                  {selectedTier === 1 ? '115%' : '105%'} HF
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm">Target HF After</span>
                <span className="text-green-400 font-medium">150%</span>
              </div>
            </div>
          </div>
        </>
      )}
      
      <button
        onClick={handleSubscribe}
        disabled={isSubscribing || selectedTier === 0 || !publicKey || hookLoading}
        className={`w-full py-3.5 rounded-xl font-semibold transition-all duration-200 ${
          selectedTier === 0 || !publicKey
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : selectedTier === 1
            ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40'
            : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40'
        }`}
      >
        {isSubscribing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Subscribing...
          </span>
        ) : selectedTier === 0 ? (
          'Select a Protection Tier'
        ) : !publicKey ? (
          'Connect Wallet to Subscribe'
        ) : (
          `Subscribe to ${tiers[selectedTier].name} Protection`
        )}
      </button>
      
      {myPosition && myPosition.protectionTier > 0 && (
        <div className="mt-4 p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-xl border border-green-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-green-400 text-lg">✓</span>
            </div>
            <div>
              <p className="text-green-400 font-medium">
                {myPosition.protectionTier === 1 ? 'Basic' : 'Premium'} Protection Active
              </p>
              <p className="text-gray-400 text-xs">
                Expires: {new Date(myPosition.protectionExpiry * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-gray-700/50">
        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">How It Works</h4>
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="text-blue-400 mt-0.5">1.</span>
            <span>Select a tier and duration, then pay the premium</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="text-blue-400 mt-0.5">2.</span>
            <span>Keepers monitor your health factor continuously</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="text-blue-400 mt-0.5">3.</span>
            <span>If HF drops below threshold, protection executes automatically</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="text-blue-400 mt-0.5">4.</span>
            <span>Collateral is added from reserve to restore your HF to 150%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProtectionCard;
