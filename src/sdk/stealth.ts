/**
 * Stealth Address Generation for VeilLend Privacy Layer
 *
 * Implements one-time stealth addresses using X25519 key exchange.
 * The user generates a private "viewing key" and derives stealth addresses
 * for deposits that only they can claim.
 *
 * Flow:
 * 1. User generates a spending keypair (stored securely client-side)
 * 2. For each deposit, derive a one-time stealth address from:
 *    - User's spending public key
 *    - Vault public key
 *    - Unique nonce
 * 3. Only the user (with spending private key) can prove ownership
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { x25519 } from '@arcium-hq/client';

const STEALTH_STORAGE_KEY = 'veillend.stealth';

/**
 * Stealth keypair stored client-side
 */
export interface StealthKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Derived stealth address for a specific deposit
 */
export interface StealthAddress {
  address: PublicKey;
  ephemeralPublicKey: Uint8Array;
  nonce: number;
  createdAt: number;
}

/**
 * Stored stealth record for persistence
 */
export interface StealthRecord {
  version: 1;
  walletAddress: string;
  spendingPublicKey: string;
  addresses: StealthAddressRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface StealthAddressRecord {
  address: string;
  ephemeralPublicKey: string;
  nonce: number;
  createdAt: number;
  vaultAddress: string;
  amount?: number;
  spent: boolean;
}

/**
 * Generate a new stealth keypair using X25519
 */
export const generateStealthKeypair = (): StealthKeypair => {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
};

/**
 * Derive a stealth address from user's spending key, vault, and nonce
 *
 * Uses X25519 ECDH to create a shared secret, then derives a Solana keypair
 * deterministically from that secret.
 */
export const deriveStealthAddress = async (
  spendingPublicKey: Uint8Array,
  vaultPublicKey: PublicKey,
  nonce: number,
): Promise<{ stealthKeypair: Keypair; ephemeralPublicKey: Uint8Array }> => {
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, spendingPublicKey);

  const seedData = new Uint8Array([
    ...sharedSecret,
    ...vaultPublicKey.toBytes(),
    ...new Uint8Array(new Uint32Array([nonce]).buffer),
  ]);

  const seedHash = await crypto.subtle.digest('SHA-256', seedData);
  const seed = new Uint8Array(seedHash);

  const stealthKeypair = Keypair.fromSeed(seed);

  return { stealthKeypair, ephemeralPublicKey };
};

/**
 * Recover a stealth address using the spending private key
 *
 * Given the ephemeral public key (stored on-chain or in note),
 * recover the stealth keypair to claim funds.
 */
export const recoverStealthAddress = async (
  spendingPrivateKey: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  vaultPublicKey: PublicKey,
  nonce: number,
): Promise<Keypair> => {
  const sharedSecret = x25519.getSharedSecret(spendingPrivateKey, ephemeralPublicKey);

  const seedData = new Uint8Array([
    ...sharedSecret,
    ...vaultPublicKey.toBytes(),
    ...new Uint8Array(new Uint32Array([nonce]).buffer),
  ]);

  const seedHash = await crypto.subtle.digest('SHA-256', seedData);
  const seed = new Uint8Array(seedHash);

  return Keypair.fromSeed(seed);
};

/**
 * Verify that a stealth address belongs to a spending key
 */
export const verifyStealthOwnership = async (
  spendingPrivateKey: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  vaultPublicKey: PublicKey,
  nonce: number,
  expectedAddress: PublicKey,
): Promise<boolean> => {
  try {
    const recovered = await recoverStealthAddress(
      spendingPrivateKey,
      ephemeralPublicKey,
      vaultPublicKey,
      nonce,
    );
    return recovered.publicKey.equals(expectedAddress);
  } catch {
    return false;
  }
};

// Persistence helpers

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const storageKeyForWallet = (walletAddress: string) =>
  `${STEALTH_STORAGE_KEY}:${walletAddress}`;

/**
 * Load stealth record from localStorage
 */
export const loadStealthRecord = (walletAddress: string): StealthRecord | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKeyForWallet(walletAddress));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StealthRecord;
    if (parsed.version !== 1 || parsed.walletAddress !== walletAddress) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Save stealth record to localStorage
 */
export const saveStealthRecord = (record: StealthRecord): void => {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }
  localStorage.setItem(storageKeyForWallet(record.walletAddress), JSON.stringify(record));
};

/**
 * Initialize or load stealth keypair for a wallet
 */
export const initializeStealthForWallet = (walletAddress: string): {
  record: StealthRecord;
  keypair: StealthKeypair;
} => {
  const existing = loadStealthRecord(walletAddress);
  const keypairKey = `${STEALTH_STORAGE_KEY}:keypair:${walletAddress}`;
  let keypair: StealthKeypair;

  if (typeof localStorage !== 'undefined') {
    const storedKeypair = localStorage.getItem(keypairKey);
    if (storedKeypair) {
      const parsed = JSON.parse(storedKeypair);
      keypair = {
        privateKey: fromHex(parsed.privateKey),
        publicKey: fromHex(parsed.publicKey),
      };
    } else {
      keypair = generateStealthKeypair();
      localStorage.setItem(
        keypairKey,
        JSON.stringify({
          privateKey: toHex(keypair.privateKey),
          publicKey: toHex(keypair.publicKey),
        }),
      );
    }
  } else {
    keypair = generateStealthKeypair();
  }

  if (existing) {
    return { record: existing, keypair };
  }

  const now = Date.now();
  const record: StealthRecord = {
    version: 1,
    walletAddress,
    spendingPublicKey: toHex(keypair.publicKey),
    addresses: [],
    createdAt: now,
    updatedAt: now,
  };

  saveStealthRecord(record);
  return { record, keypair };
};

/**
 * Add a new stealth address to the record
 */
export const addStealthAddress = (
  walletAddress: string,
  stealthAddress: PublicKey,
  ephemeralPublicKey: Uint8Array,
  vaultAddress: PublicKey,
  nonce: number,
  amount?: number,
): StealthRecord => {
  const record = loadStealthRecord(walletAddress);
  if (!record) {
    throw new Error('Stealth record not initialized');
  }

  const now = Date.now();
  record.addresses.push({
    address: stealthAddress.toBase58(),
    ephemeralPublicKey: toHex(ephemeralPublicKey),
    nonce,
    createdAt: now,
    vaultAddress: vaultAddress.toBase58(),
    amount,
    spent: false,
  });
  record.updatedAt = now;

  saveStealthRecord(record);
  return record;
};

/**
 * Mark a stealth address as spent
 */
export const markStealthAddressSpent = (
  walletAddress: string,
  stealthAddress: string,
): StealthRecord => {
  const record = loadStealthRecord(walletAddress);
  if (!record) {
    throw new Error('Stealth record not initialized');
  }

  const addr = record.addresses.find((a) => a.address === stealthAddress);
  if (addr) {
    addr.spent = true;
    record.updatedAt = Date.now();
    saveStealthRecord(record);
  }

  return record;
};

/**
 * Get next nonce for a vault
 */
export const getNextNonce = (walletAddress: string, vaultAddress: string): number => {
  const record = loadStealthRecord(walletAddress);
  if (!record) return 0;

  const vaultAddresses = record.addresses.filter((a) => a.vaultAddress === vaultAddress);
  if (vaultAddresses.length === 0) return 0;

  return Math.max(...vaultAddresses.map((a) => a.nonce)) + 1;
};

/**
 * Get unspent stealth addresses for a vault
 */
export const getUnspentStealthAddresses = (
  walletAddress: string,
  vaultAddress?: string,
): StealthAddressRecord[] => {
  const record = loadStealthRecord(walletAddress);
  if (!record) return [];

  return record.addresses.filter((a) => {
    if (a.spent) return false;
    if (vaultAddress && a.vaultAddress !== vaultAddress) return false;
    return true;
  });
};

/**
 * Clear stealth record (for testing/reset)
 */
export const clearStealthRecord = (walletAddress: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKeyForWallet(walletAddress));
  localStorage.removeItem(`${STEALTH_STORAGE_KEY}:keypair:${walletAddress}`);
};
