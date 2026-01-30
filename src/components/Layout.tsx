import React, { useEffect } from 'react';
import { type WalletName } from '@solana/wallet-adapter-base';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { isE2e } from '../config/e2e';

type View = 'MARKET' | 'PORTFOLIO';

interface LayoutProps {
  children: React.ReactNode;
  activeView: View;
  onViewChange: (view: View) => void;
  clusterLabel?: string;
}

const shortenAddress = (address: string) =>
  `${address.slice(0, 4)}...${address.slice(-4)}`;

export const Layout: React.FC<LayoutProps> = ({
  children,
  activeView,
  onViewChange,
  clusterLabel,
}) => {
  const { publicKey, connected, connect, disconnect, select } = useWallet();
  const { setVisible } = useWalletModal();
  const e2eEnabled = isE2e();
  const showDebug = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('debug');

  useEffect(() => {
    if (!e2eEnabled || connected) return;
    try {
      console.debug('[strict][ui] wallet autoConnect', {
        connected,
        e2eEnabled,
      });
      select('TestWallet' as WalletName);
      connect().catch((error) => {
        console.error('[strict][ui] wallet autoConnect error', {
          message: (error as Error | undefined)?.message,
        });
      });
    } catch {
    }
  }, [connect, connected, e2eEnabled, select]);

  const handleWalletClick = async () => {
    if (!connected) {
      console.debug('[strict][ui] wallet connect modal', {
        connected,
        walletPrefix: publicKey ? shortenAddress(publicKey.toBase58()) : null,
      });
      setVisible(true);
      return;
    }
    console.debug('[strict][ui] wallet disconnect', {
      walletPrefix: publicKey ? shortenAddress(publicKey.toBase58()) : null,
    });
    await disconnect();
  };

  const handleCopyLogs = async () => {
    const exporter = (window as Window & {
      __VEILLEND_STRICT_LOGS_EXPORT__?: () => string;
    }).__VEILLEND_STRICT_LOGS_EXPORT__;
    if (!exporter || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(exporter());
      console.debug('[strict][ui] debug log copied');
    } catch (error) {
      console.error('[strict][ui] debug log copy failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <nav className="border-b border-white/10 py-4 glass sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap gap-4 justify-between items-center">
          <button
            type="button"
            className="flex items-center gap-3"
            onClick={() => onViewChange('MARKET')}
          >
            <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-400 via-cyan-400 to-indigo-500 shadow-lg shadow-cyan-500/30" />
            <span className="text-xl font-bold gradient-text tracking-tight">VeilLend</span>
            <span className="text-[10px] uppercase tracking-[0.35em] text-slate-300 ml-2">
              Beta
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => onViewChange('PORTFOLIO')}
              className={`transition-colors uppercase tracking-[0.2em] text-[11px] ${
                activeView === 'PORTFOLIO'
                  ? 'text-white underline underline-offset-8 decoration-emerald-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Portfolio
            </button>
            <button
              type="button"
              onClick={() => onViewChange('MARKET')}
              className={`transition-colors uppercase tracking-[0.2em] text-[11px] ${
                activeView === 'MARKET'
                  ? 'text-white underline underline-offset-8 decoration-cyan-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Markets
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {clusterLabel ?? 'Localnet'}
            </div>
            {showDebug && (
              <button
                type="button"
                onClick={handleCopyLogs}
                className="text-[10px] uppercase tracking-[0.2em] text-cyan-200 border border-cyan-400/40 px-3 py-2 rounded-full hover:bg-cyan-500/10"
              >
                Copy Debug Log
              </button>
            )}
            <button
              type="button"
              onClick={handleWalletClick}
              className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 ${
                connected
                  ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-200 font-mono'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
              }`}
            >
              {connected && publicKey ? (
                <>
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  {shortenAddress(publicKey.toBase58())}
                </>
              ) : (
                'Connect Wallet'
              )}
            </button>
          </div>
        </div>
      </nav>
      <main className="flex-grow container mx-auto px-4 py-8 max-w-6xl">
        {children}
      </main>
      <footer className="border-t border-white/10 py-6 text-center text-slate-500 text-xs">
        &copy; 2026 VeilLend - Privacy-First Lending Broker on Solana.
      </footer>
    </div>
  );
};
