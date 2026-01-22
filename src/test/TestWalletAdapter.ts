import {
  BaseWalletAdapter,
  type WalletName,
  WalletReadyState,
  type SendTransactionOptions,
} from '@solana/wallet-adapter-base';
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from '@solana/web3.js';

const TEST_WALLET_NAME = 'TestWallet' as WalletName<'TestWallet'>;
const TEST_WALLET_ICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

export class TestWalletAdapter extends BaseWalletAdapter<'TestWallet'> {
  name = TEST_WALLET_NAME;
  url = 'https://veillend.local/test-wallet';
  icon = TEST_WALLET_ICON;
  readyState = WalletReadyState.Loadable;
  publicKey: PublicKey | null = null;
  connecting = false;
  supportedTransactionVersions = new Set<TransactionVersion>([0]);
  private keypair: Keypair | null = null;

  constructor() {
    super();
    this.keypair = Keypair.generate();
    this.publicKey = this.keypair.publicKey;
    if (typeof window !== 'undefined') {
      (window as Window & { __VEILLEND_TEST_WALLET__?: string }).__VEILLEND_TEST_WALLET__ =
        this.publicKey.toBase58();
    }
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    try {
      if (!this.keypair) {
        this.keypair = Keypair.generate();
      }
      this.publicKey = this.keypair.publicKey;
      if (typeof window !== 'undefined') {
        (window as Window & { __VEILLEND_TEST_WALLET__?: string }).__VEILLEND_TEST_WALLET__ =
          this.publicKey.toBase58();
      }
      this.emit('connect', this.publicKey);
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.keypair = null;
    this.publicKey = null;
    this.emit('disconnect');
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ): Promise<string> {
    if (!this.keypair) {
      throw new Error('Test wallet not connected');
    }

    const extraSigners = (options?.signers as Keypair[] | undefined) ?? [];
    const sendOptions: SendOptions | undefined = options;

    if (transaction instanceof Transaction) {
      const prepared = await this.prepareTransaction(transaction, connection, sendOptions);
      prepared.partialSign(this.keypair, ...extraSigners);
      const signature = await connection.sendRawTransaction(prepared.serialize(), sendOptions);
      return signature;
    }

    transaction.sign([this.keypair, ...extraSigners]);
    const signature = await connection.sendRawTransaction(transaction.serialize(), sendOptions);
    return signature;
  }
}
