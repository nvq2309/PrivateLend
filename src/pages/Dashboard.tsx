import { FC, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ProtectionCard } from '../components/ProtectionCard';
import { useVeilLend } from '../hooks/useVeilLend';

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export const Dashboard: FC = () => {
  const { publicKey, connected } = useWallet();
  const {
    myPosition,
    vaultStats,
    protectionPoolStats,
    isLoading,
    deposit,
    withdraw,
    borrow,
    repay,
  } = useVeilLend(WSOL_MINT);
  
  const [activeTab, setActiveTab] = useState<'deposit' | 'borrow'>('deposit');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const healthFactorColor = useMemo(() => {
    if (!myPosition || myPosition.healthFactor === 0) return 'text-gray-400';
    if (myPosition.healthFactor >= 15000) return 'text-green-400';
    if (myPosition.healthFactor >= 12000) return 'text-yellow-400';
    if (myPosition.healthFactor >= 10500) return 'text-orange-400';
    return 'text-red-400';
  }, [myPosition]);

  const formatHealth = (hf: number) => {
    if (hf === 0) return '∞';
    return (hf / 10000).toFixed(2);
  };

  const handleAction = async (action: 'deposit' | 'withdraw' | 'borrow' | 'repay') => {
    if (!amount || parseFloat(amount) <= 0) return;
    
    setIsSubmitting(true);
    try {
      const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
      
      switch (action) {
        case 'deposit':
          await deposit(amountLamports);
          break;
        case 'withdraw':
          await withdraw(amountLamports);
          break;
        case 'borrow':
          await borrow(amountLamports);
          break;
        case 'repay':
          await repay(amountLamports);
          break;
      }
      setAmount('');
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-8">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-4">
              VeilLend
            </h1>
            <p className="text-gray-400 text-lg">Privacy-preserving lending with liquidation protection</p>
          </div>
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <nav className="border-b border-gray-700/50 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-xl">🛡️</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              VeilLend
            </span>
          </div>
          <WalletMultiButton />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 rounded-2xl p-6 border border-blue-500/30">
            <p className="text-gray-400 text-sm mb-1">Total Deposited</p>
            <p className="text-3xl font-bold text-white">
              {vaultStats ? (vaultStats.totalCollateral / LAMPORTS_PER_SOL).toFixed(4) : '0.00'} SOL
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 rounded-2xl p-6 border border-purple-500/30">
            <p className="text-gray-400 text-sm mb-1">Total Borrowed</p>
            <p className="text-3xl font-bold text-white">
              {vaultStats ? (vaultStats.totalBorrowed / LAMPORTS_PER_SOL).toFixed(4) : '0.00'} SOL
            </p>
          </div>
          <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 rounded-2xl p-6 border border-green-500/30">
            <p className="text-gray-400 text-sm mb-1">Protection Pool</p>
            <p className="text-3xl font-bold text-white">
              {protectionPoolStats ? (protectionPoolStats.reserveBalance / LAMPORTS_PER_SOL).toFixed(4) : '0.00'} SOL
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {protectionPoolStats?.totalSubscribers || 0} subscribers
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700/50 p-6">
              <h2 className="text-lg font-semibold mb-4">Your Position</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <p className="text-gray-400 text-sm">Deposited</p>
                  <p className="text-2xl font-bold">
                    {myPosition ? (myPosition.deposit / LAMPORTS_PER_SOL).toFixed(4) : '0.00'}
                  </p>
                  <p className="text-gray-500 text-xs">SOL</p>
                </div>
                <div className="bg-gray-900/50 rounded-xl p-4">
                  <p className="text-gray-400 text-sm">Borrowed</p>
                  <p className="text-2xl font-bold">
                    {myPosition ? (myPosition.borrow / LAMPORTS_PER_SOL).toFixed(4) : '0.00'}
                  </p>
                  <p className="text-gray-500 text-xs">SOL</p>
                </div>
              </div>
              
              <div className="bg-gray-900/50 rounded-xl p-4 mb-6">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Health Factor</span>
                  <span className={`text-2xl font-bold ${healthFactorColor}`}>
                    {myPosition ? formatHealth(myPosition.healthFactor) : '∞'}
                  </span>
                </div>
                <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${
                      !myPosition || myPosition.healthFactor === 0 
                        ? 'bg-gray-500 w-full' 
                        : myPosition.healthFactor >= 15000 
                        ? 'bg-green-500' 
                        : myPosition.healthFactor >= 12000 
                        ? 'bg-yellow-500' 
                        : 'bg-red-500'
                    }`}
                    style={{ 
                      width: myPosition && myPosition.healthFactor > 0 
                        ? `${Math.min((myPosition.healthFactor / 20000) * 100, 100)}%` 
                        : '100%' 
                    }}
                  />
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setActiveTab('deposit')}
                  className={`flex-1 py-2 rounded-lg font-medium transition ${
                    activeTab === 'deposit'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Deposit/Withdraw
                </button>
                <button
                  onClick={() => setActiveTab('borrow')}
                  className={`flex-1 py-2 rounded-lg font-medium transition ${
                    activeTab === 'borrow'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Borrow/Repay
                </button>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-gray-900/50 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">SOL</span>
                </div>
                
                {activeTab === 'deposit' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleAction('deposit')}
                      disabled={isSubmitting || isLoading}
                      className="py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-medium transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Processing...' : 'Deposit'}
                    </button>
                    <button
                      onClick={() => handleAction('withdraw')}
                      disabled={isSubmitting || isLoading}
                      className="py-3 bg-gray-600 hover:bg-gray-700 rounded-xl font-medium transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Processing...' : 'Withdraw'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleAction('borrow')}
                      disabled={isSubmitting || isLoading}
                      className="py-3 bg-purple-600 hover:bg-purple-700 rounded-xl font-medium transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Processing...' : 'Borrow'}
                    </button>
                    <button
                      onClick={() => handleAction('repay')}
                      disabled={isSubmitting || isLoading}
                      className="py-3 bg-gray-600 hover:bg-gray-700 rounded-xl font-medium transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Processing...' : 'Repay'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700/50 p-6">
              <h3 className="text-lg font-semibold mb-4">Vault Parameters</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">LTV Ratio</span>
                  <span className="text-white font-medium">{vaultStats?.ltv || 75}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Liquidation Threshold</span>
                  <span className="text-white font-medium">{vaultStats?.liquidationThreshold || 82.5}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Utilization</span>
                  <span className="text-white font-medium">
                    {vaultStats && vaultStats.totalCollateral > 0
                      ? ((vaultStats.totalBorrowed / vaultStats.totalCollateral) * 100).toFixed(1)
                      : '0'}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <ProtectionCard />

            {protectionPoolStats && protectionPoolStats.totalExecutions > 0 && (
              <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700/50 p-6">
                <h3 className="text-lg font-semibold mb-4">Protection Pool Stats</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total Executions</span>
                    <span className="text-white font-medium">{protectionPoolStats.totalExecutions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Premiums Collected</span>
                    <span className="text-white font-medium">
                      {(protectionPoolStats.totalPremiumCollected / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Protection Paid Out</span>
                    <span className="text-white font-medium">
                      {(protectionPoolStats.totalProtectionPaid / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
