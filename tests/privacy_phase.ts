/// <reference path="./types/snarkjs.d.ts" />
import { Keypair } from '@solana/web3.js';
import { expect } from 'chai';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import * as snarkjs from 'snarkjs';

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
  computeCommitment,
  computeNullifierHash,
  toHex,
  fromHex,
  verifyNoteOwnership,
  savePrivacyNote,
  loadPrivacyNotes,
  getNextNoteIndex,
  getTotalBalance,
  clearPrivacyNotes,
} from '../src/sdk/commitment';
import { isNullifierSpent, markNullifierSpent, clearNullifierRegistry } from '../src/sdk/proof';
import { getMerkleProof } from '../src/sdk/merkle';
import { buildNoteStringFromPrivacyNote, buildPrivacyNoteFromNoteString, decodeNoteString } from '../src/sdk/noteString';
import { bytesToBigIntBE, bigintToBytesBE, poseidonHash } from '../src/sdk/poseidon';
import { buildZkInputs } from '../src/sdk/zkInputs';
import { buildProofCacheKey, getCachedProof, hashZkInputs, setCachedProof } from '../src/sdk/proofCache';
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
    return this.store[key] ?? null;
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

      const verified = await verifyNoteOwnership(note, 'SOL');
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

  describe('Note string serialization', () => {
    it('round-trips note string payload', async () => {
      const ownerPubkey = new Uint8Array(32).fill(9);
      const vaultAddress = Keypair.generate().publicKey.toBase58();
      const note = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_000n,
        borrowAmount: 250n,
        noteIndex: 2,
        collateralSymbol: 'SOL',
      });
      const noteRecord = await createNoteRecord({
        walletAddress,
        lastTxnId: 'tx-note-string',
        timestamp: 1700001234000,
      });
      const noteString = buildNoteStringFromPrivacyNote(note, 'SOL', noteRecord.noteHash);
      const decoded = decodeNoteString(noteString);
      expect(decoded.noteHash).to.equal(noteRecord.noteHash);
      expect(decoded.vaultAddress).to.equal(vaultAddress);
      expect(decoded.noteIndex).to.equal(2n);

      const restored = await buildPrivacyNoteFromNoteString({
        noteString,
        walletAddress,
        ownerPubkey,
        collateralSymbol: 'SOL',
      });
      expect(restored.commitment).to.equal(note.commitment);
      expect(restored.nullifier).to.equal(note.nullifier);
      expect(restored.noteIndex).to.equal(note.noteIndex);
    });
  });

  describe('ZK input generation + nullifier registry', () => {
    it('Commitment alignment matches circuit inputs', async () => {
      const nullifier = new Uint8Array(32).fill(1);
      const secret = new Uint8Array(32).fill(2);
      const supplySol = 123n;
      const supplyUsdc = 0n;
      const borrowSol = 0n;
      const borrowUsdc = 45n;
      const timestamp = 1700000000123n;

      const commitment = await computeCommitment({
        nullifier,
        secret,
        supplySol,
        supplyUsdc,
        borrowSol,
        borrowUsdc,
        timestamp,
      });

      const expectedCommitment = await poseidonHash([
        bytesToBigIntBE(nullifier),
        bytesToBigIntBE(secret),
        supplySol,
        supplyUsdc,
        borrowSol,
        borrowUsdc,
        timestamp,
      ]);

      expect(commitment).to.equal(toHex(bigintToBytesBE(expectedCommitment, 32)));

      const nullifierHash = await computeNullifierHash(nullifier);
      const expectedNullifierHash = await poseidonHash([bytesToBigIntBE(nullifier), 0n]);
      expect(nullifierHash).to.equal(toHex(bigintToBytesBE(expectedNullifierHash, 32)));
    });

    it('builds action inputs bound to merkle root', async () => {
      const ownerPubkey = new Uint8Array(32).fill(5);
      const vaultAddress = 'VaultPrivacyTest44444444444444444444444444';
      const oldNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_000n,
        borrowAmount: 0n,
        noteIndex: 0,
        collateralSymbol: 'SOL',
      });
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_500n,
        borrowAmount: 0n,
        noteIndex: 1,
        collateralSymbol: 'SOL',
      });

      const leaves = [new Uint8Array(fromHex(oldNote.commitment))];
      const merkleProof = await getMerkleProof(leaves, oldNote.noteIndex, 4);
      const inputs = await buildZkInputs({
        action: 'supply',
        oldNote,
        newNote,
        merkleProof,
        collateralSymbol: 'SOL',
        deltaAmount: 500n,
      });

      const expectedRoot = bytesToBigIntBE(merkleProof.root).toString();
      const expectedOldCommitment = bytesToBigIntBE(fromHex(oldNote.commitment)).toString();
      const expectedNewCommitment = bytesToBigIntBE(fromHex(newNote.commitment)).toString();
      const nullifierHash = await poseidonHash([
        bytesToBigIntBE(fromHex(oldNote.nullifier)),
        0n,
      ]);

      expect(inputs.merkleRoot).to.equal(expectedRoot);
      expect(inputs.publicNullifierHash).to.equal(nullifierHash.toString());
      expect(inputs.publicOldCommitment).to.equal(expectedOldCommitment);
      expect(inputs.publicNewCommitment).to.equal(expectedNewCommitment);
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

  describe('Proof generation', () => {
    it('Proof generation for supply action', async () => {
      const ownerPubkey = new Uint8Array(32).fill(4);
      const vaultAddress = Keypair.generate().publicKey.toBase58();
      const oldNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_000n,
        borrowAmount: 0n,
        noteIndex: 0,
        collateralSymbol: 'SOL',
      });
      const newNote = await createPrivacyNote({
        walletAddress,
        ownerPubkey,
        vaultAddress,
        depositAmount: 1_500n,
        borrowAmount: 0n,
        noteIndex: 1,
        collateralSymbol: 'SOL',
      });

      const leaves = [new Uint8Array(fromHex(oldNote.commitment))];
      const merkleProof = await getMerkleProof(leaves, oldNote.noteIndex, 4);
      const inputs = await buildZkInputs({
        action: 'supply',
        oldNote,
        newNote,
        merkleProof,
        collateralSymbol: 'SOL',
        deltaAmount: 500n,
      });

      const wasmPath = path.resolve(process.cwd(), 'public/zk/supply/supply.wasm');
      const zkeyPath = path.resolve(process.cwd(), 'public/zk/supply/setup_final.zkey');
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);

      expect(proof).to.be.ok;
      expect(publicSignals).to.be.an('array').that.is.not.empty;
    });
  });

  describe('Proof cache', () => {
    it('caches proofs by artifact version and input hash', async () => {
      const input = {
        action: 'supply',
        values: ['1', '2', '3'],
        nested: { a: 1, b: 'x' },
      };
      const inputHash = await hashZkInputs(input);
      const keyV1 = buildProofCacheKey('supply', 'v1', inputHash);
      const keyV2 = buildProofCacheKey('supply', 'v2', inputHash);
      expect(keyV1).to.not.equal(keyV2);

      const record = {
        proof: {
          aX: [1],
          aY: [2],
          bX0: [3],
          bX1: [4],
          bY0: [5],
          bY1: [6],
          cX: [7],
          cY: [8],
        },
        publicSignals: ['1', '2'],
      };

      await setCachedProof('supply', input, record);
      const cached = await getCachedProof('supply', input);
      expect(cached?.publicSignals).to.deep.equal(record.publicSignals);
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
