import { expect } from 'chai';
import { webcrypto } from 'crypto';
import { Keypair } from '@solana/web3.js';

import {
  buildNoteSeed,
  createNoteRecord,
  createInitialNoteRecord,
  rotateNoteRecord,
  saveNoteRecord,
  loadNoteRecord,
  deriveNoteHash,
} from '../src/sdk/notes';
import {
  createPrivacyNote,
  verifyNoteOwnership,
  savePrivacyNote,
  loadPrivacyNotes,
  getNextNoteIndex,
  getTotalBalance,
  clearPrivacyNotes,
  initializeSecrets,
} from '../src/sdk/commitment';
import {
  generateOwnershipProof,
  verifyOwnershipProof,
  generateSpendProof,
  verifySpendProof,
  generateTransactionProof,
  verifyTransactionProof,
  isNullifierSpent,
  markNullifierSpent,
  clearNullifierRegistry,
} from '../src/sdk/proof';
import {
  generateStealthKeypair,
  deriveStealthAddress,
  recoverStealthAddress,
  verifyStealthOwnership,
  initializeStealthForWallet,
  addStealthAddress,
  markStealthAddressSpent,
  getNextNonce,
  getUnspentStealthAddresses,
  clearStealthRecord,
} from '../src/sdk/stealth';

type StorageMap = Record<string, string>;

class LocalStorageMock {
  private store: StorageMap = {};

  getItem(key: string) {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null;
  }

  setItem(key: string, value: string) {
    this.store[key] = value;
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }

  keys() {
    return Object.keys(this.store);
  }
}

const ensureCrypto = () => {
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto = webcrypto as Crypto;
  }
};

describe('Privacy Phase - SDK', () => {
  const walletAddress = 'WalletPrivacyTest1111111111111111111111111111';
  let localStorageMock: LocalStorageMock;

  beforeEach(() => {
    ensureCrypto();
    localStorageMock = new LocalStorageMock();
    globalThis.localStorage = localStorageMock as unknown as Storage;
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Notes seed rule + storage', () => {
    it('builds deterministic seed and hash', async () => {
      const timestamp = 1700000000000;
      const seed = buildNoteSeed({
        walletAddress,
        lastTxnId: '0',
        timestamp,
      });
      expect(seed).to.equal(`${timestamp}:${walletAddress}:0`);

      const expectedHash = await deriveNoteHash(seed);
      const record = await createNoteRecord({
        walletAddress,
        lastTxnId: 0,
        timestamp,
      });
      expect(record.noteHash).to.equal(expectedHash);
      expect(record.createdAt).to.equal(timestamp);
      expect(record.updatedAt).to.equal(timestamp);
    });

    it('rotates note while preserving createdAt', async () => {
      const initial = await createInitialNoteRecord(walletAddress);
      const rotated = await rotateNoteRecord(walletAddress, 'tx-123', initial);
      const expectedSeed = `${rotated.updatedAt}:${walletAddress}:tx-123`;
      const expectedHash = await deriveNoteHash(expectedSeed);
      expect(rotated.walletAddress).to.equal(walletAddress);
      expect(rotated.lastTxnId).to.equal('tx-123');
      expect(rotated.noteHash).to.equal(expectedHash);
      expect(rotated.createdAt).to.equal(initial.createdAt);
      expect(rotated.updatedAt).to.be.at.least(initial.updatedAt);
    });

    it('enforces one note per wallet in storage', async () => {
      const first = await createNoteRecord({
        walletAddress,
        lastTxnId: '0',
        timestamp: 1700000001000,
      });
      saveNoteRecord(first);
      expect(loadNoteRecord(walletAddress)?.noteHash).to.equal(first.noteHash);

      const second = await createNoteRecord({
        walletAddress,
        lastTxnId: 'tx-2',
        timestamp: 1700000002000,
        previous: first,
      });
      saveNoteRecord(second);
      const loaded = loadNoteRecord(walletAddress);
      expect(loaded?.noteHash).to.equal(second.noteHash);
      expect(localStorageMock.keys().length).to.equal(1);
    });
  });

  describe('Commitment notes + balances', () => {
    it('creates privacy note and verifies ownership', async () => {
      const ownerPubkey = new Uint8Array(32).fill(7);
      const vaultAddress = 'VaultPrivacyTest11111111111111111111111111';
      const note = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 5_000n,
        borrowAmount: 2_500n,
        noteIndex: 0,
      });

      const verified = await verifyNoteOwnership(note, ownerPubkey);
      expect(verified).to.equal(true);
    });

    it('aggregates balances from unspent notes', async () => {
      clearPrivacyNotes(walletAddress);
      const ownerPubkey = new Uint8Array(32).fill(3);
      const vaultAddress = 'VaultPrivacyTest22222222222222222222222222';

      const noteA = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 100n,
        borrowAmount: 40n,
        noteIndex: getNextNoteIndex(walletAddress),
      });
      savePrivacyNote(walletAddress, noteA);

      const noteB = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 300n,
        borrowAmount: 60n,
        noteIndex: getNextNoteIndex(walletAddress),
      });
      savePrivacyNote(walletAddress, noteB);

      const totals = getTotalBalance(walletAddress, vaultAddress);
      expect(totals.deposit).to.equal(400n);
      expect(totals.borrow).to.equal(100n);
      expect(loadPrivacyNotes(walletAddress)).to.have.length(2);
    });
  });

  describe('Proof generation + nullifier registry', () => {
    it('generates and verifies ownership/spend proofs', async () => {
      const ownerPubkey = new Uint8Array(32).fill(9);
      const vaultAddress = 'VaultPrivacyTest33333333333333333333333333';
      const note = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_000n,
        borrowAmount: 0n,
        noteIndex: 0,
      });
      const secrets = initializeSecrets(walletAddress);

      const ownershipProof = await generateOwnershipProof(note, secrets);
      expect(await verifyOwnershipProof(ownershipProof)).to.equal(true);

      const recipient = Keypair.generate().publicKey.toBase58();
      const spendProof = await generateSpendProof(note, secrets, recipient);
      expect(await verifySpendProof(spendProof)).to.equal(true);

      const txnProof = await generateTransactionProof(note, secrets, recipient);
      expect(await verifyTransactionProof(txnProof)).to.equal(true);
    });

    it('tracks nullifier usage', async () => {
      const nullifier = 'ab'.repeat(32);
      expect(isNullifierSpent(nullifier)).to.equal(false);
      markNullifierSpent(nullifier);
      expect(isNullifierSpent(nullifier)).to.equal(true);
      clearNullifierRegistry();
      expect(isNullifierSpent(nullifier)).to.equal(false);
    });
  });

  describe('Stealth addresses', () => {
    it('derives and recovers stealth address', async () => {
      const spendingKeypair = generateStealthKeypair();
      const vaultPubkey = Keypair.generate().publicKey;
      const { stealthKeypair, ephemeralPublicKey } = await deriveStealthAddress(
        spendingKeypair.publicKey,
        vaultPubkey,
        0,
      );

      const recovered = await recoverStealthAddress(
        spendingKeypair.privateKey,
        ephemeralPublicKey,
        vaultPubkey,
        0,
      );

      expect(recovered.publicKey.equals(stealthKeypair.publicKey)).to.equal(true);
      const owned = await verifyStealthOwnership(
        spendingKeypair.privateKey,
        ephemeralPublicKey,
        vaultPubkey,
        0,
        stealthKeypair.publicKey,
      );
      expect(owned).to.equal(true);
    });

    it('tracks stealth address records and nonces', async () => {
      const vaultPubkey = Keypair.generate().publicKey;
      const { record, keypair } = initializeStealthForWallet(walletAddress);
      expect(record.walletAddress).to.equal(walletAddress);

      const derived = await deriveStealthAddress(keypair.publicKey, vaultPubkey, 0);
      addStealthAddress(
        walletAddress,
        derived.stealthKeypair.publicKey,
        derived.ephemeralPublicKey,
        vaultPubkey,
        0,
        100,
      );

      expect(getNextNonce(walletAddress, vaultPubkey.toBase58())).to.equal(1);
      expect(getUnspentStealthAddresses(walletAddress, vaultPubkey.toBase58())).to.have.length(1);

      markStealthAddressSpent(walletAddress, derived.stealthKeypair.publicKey.toBase58());
      expect(getUnspentStealthAddresses(walletAddress, vaultPubkey.toBase58())).to.have.length(0);

      clearStealthRecord(walletAddress);
      expect(getUnspentStealthAddresses(walletAddress)).to.have.length(0);
    });
  });
});
