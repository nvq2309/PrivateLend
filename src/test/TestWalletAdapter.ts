import {
  BaseMessageSignerWalletAdapter,
  type WalletName,
  type TransactionOrVersionedTransaction,
  WalletReadyState,
  type SendTransactionOptions,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionVersion,
  VersionedTransaction,
} from '@solana/web3.js';

const TEST_WALLET_NAME = 'TestWallet' as WalletName<'TestWallet'>;
const TEST_WALLET_ICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

export class TestWalletAdapter extends BaseMessageSignerWalletAdapter<'TestWallet'> {
  name = TEST_WALLET_NAME;
  url = 'https://veillend.local/test-wallet';
  icon = TEST_WALLET_ICON;
  supportedTransactionVersions = new Set<TransactionVersion>(['legacy', 0]);
  private _readyState: WalletReadyState;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;
  private _keypair: Keypair | null = null;

  constructor() {
    super();
    this._readyState = typeof window === 'undefined' ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
    if (this._readyState !== WalletReadyState.Unsupported) {
      const overrideSecret = this.getOverrideSecret();
      this._keypair = overrideSecret ? Keypair.fromSecretKey(overrideSecret) : Keypair.generate();
      this._publicKey = this._keypair.publicKey;
      this.writeWindowWallet(this._publicKey);
    }
    this.emit('readyStateChange', this._readyState);
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  get readyState() {
    return this._readyState;
  }

  private getOverrideSecret(): Uint8Array | null {
    if (typeof window === 'undefined') return null;
    const raw = (window as Window & { __VEILLEND_E2E_WALLET_SECRET__?: number[] })
      .__VEILLEND_E2E_WALLET_SECRET__;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return new Uint8Array(raw);
  }

  async autoConnect(): Promise<void> {
    if (this.readyState !== WalletReadyState.Unsupported) {
      await this.connect();
    }
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    if (this.readyState === WalletReadyState.Unsupported) {
      const error = new WalletNotReadyError();
      this.emit('error', error);
      throw error;
    }
    this._connecting = true;
    console.debug('[strict][wallet] connect start', {
      readyState: this.readyState,
    });
    try {
      if (!this._keypair) {
        const overrideSecret = this.getOverrideSecret();
        this._keypair = overrideSecret ? Keypair.fromSecretKey(overrideSecret) : Keypair.generate();
      }
      this._publicKey = this._keypair.publicKey;
      this.writeWindowWallet(this._publicKey);
      this.emit('connect', this._publicKey);
      console.debug('[strict][wallet] connect success', {
        walletPrefix: this._publicKey.toBase58().slice(0, 4),
      });
    } catch (error) {
      const wrapped = error instanceof WalletNotReadyError || error instanceof WalletConnectionError
        ? error
        : new WalletConnectionError((error as Error | undefined)?.message, error);
      this.emit('error', wrapped);
      console.error('[strict][wallet] connect error', {
        message: wrapped.message,
      });
      throw wrapped;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      this._keypair = null;
      this._publicKey = null;
      this.clearWindowWallet();
      this.emit('disconnect');
      console.debug('[strict][wallet] disconnect');
    } catch (error) {
      const wrapped = new WalletDisconnectionError((error as Error | undefined)?.message, error);
      this.emit('error', wrapped);
      console.error('[strict][wallet] disconnect error', {
        message: wrapped.message,
      });
      throw wrapped;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (!this._keypair) {
      const error = new WalletNotConnectedError();
      this.emit('error', error);
      throw error;
    }
    try {
      if (transaction instanceof Transaction) {
        transaction.partialSign(this._keypair);
      } else {
        transaction.sign([this._keypair]);
      }
      console.debug('[strict][wallet] signTransaction', {
        walletPrefix: this._publicKey?.toBase58().slice(0, 4) ?? null,
      });
      return transaction;
    } catch (error) {
      const wrapped = new WalletSignTransactionError((error as Error | undefined)?.message, error);
      this.emit('error', wrapped);
      console.error('[strict][wallet] signTransaction error', {
        message: wrapped.message,
      });
      throw wrapped;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      console.debug('[strict][wallet] signMessage', { length: message.length });
      throw new WalletSignMessageError('Test wallet does not support signMessage');
    } catch (error) {
      const wrapped = error instanceof WalletSignMessageError
        ? error
        : new WalletSignMessageError((error as Error | undefined)?.message, error);
      this.emit('error', wrapped);
      console.error('[strict][wallet] signMessage error', { message: wrapped.message });
      throw wrapped;
    }
  }

  async sendTransaction(
    transaction: TransactionOrVersionedTransaction<this['supportedTransactionVersions']>,
    connection: Connection,
    options?: SendTransactionOptions,
  ): Promise<string> {
    const versioned = transaction instanceof VersionedTransaction;
    console.debug('[strict][wallet] sendTransaction start', {
      versioned,
      version: versioned ? transaction.version : 'legacy',
    });
    try {
      const signature = await super.sendTransaction(transaction, connection, options ?? {});
      console.debug('[strict][wallet] sendTransaction success', { signature });
      return signature;
    } catch (error) {
      const wrapped = error instanceof WalletSendTransactionError
        ? error
        : new WalletSendTransactionError((error as Error | undefined)?.message, error);
      this.emit('error', wrapped);
      console.error('[strict][wallet] sendTransaction error', {
        message: wrapped.message,
      });
      throw wrapped;
    }
  }

  private writeWindowWallet(publicKey: PublicKey) {
    if (typeof window !== 'undefined') {
      (window as Window & { __VEILLEND_TEST_WALLET__?: string }).__VEILLEND_TEST_WALLET__ =
        publicKey.toBase58();
    }
  }

  private clearWindowWallet() {
    if (typeof window !== 'undefined') {
      delete (window as Window & { __VEILLEND_TEST_WALLET__?: string }).__VEILLEND_TEST_WALLET__;
    }
  }
}
