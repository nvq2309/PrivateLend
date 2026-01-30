import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

import App from './App.tsx';
import { isE2e } from './config/e2e';
import { SOLANA_ENDPOINT } from './config/solana';
import { TestWalletAdapter } from './test/TestWalletAdapter';
import { installStrictLogCapture } from './debug/logCapture';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';

const e2eEnabled = isE2e();
const wallets = e2eEnabled
  ? [new TestWalletAdapter()]
  : [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

if (e2eEnabled && typeof window !== 'undefined') {
  window.localStorage.setItem('walletName', JSON.stringify('TestWallet'));
}

if (typeof window !== 'undefined') {
  (window as Window & { __VEILLEND_TEST_MODE__?: boolean }).__VEILLEND_TEST_MODE__ = e2eEnabled;
}

installStrictLogCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={SOLANA_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
)
