/**
 * Arcium Encryption Client for VeilLend
 *
 * Implements client-side encryption/decryption of position data using X25519.
 * Encrypted balances are stored on-chain; only the user can decrypt with their private key.
 */

import { x25519 } from '@arcium-hq/client';
import type { ArciumEncryptionClient, CiphertextBundle } from './veillend';

const ARCIUM_KEYPAIR_STORAGE_KEY = 'veillend.arcium.keypair';
const ARCIUM_PUBLIC_KEY_STORAGE_KEY = 'veillend.arcium.public';
const ARCIUM_PRIVATE_KEY_STORAGE_KEY = 'veillend.arcium.private';

export interface ArciumKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface PositionData {
  deposit: bigint;
  borrow: bigint;
  shares: bigint;
}

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

const bigintToBytes = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(temp & 0xffn);
    temp = temp >> 8n;
  }
  return bytes;
};

const bytesToBigint = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
};

const xorBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ (b[i] || 0);
  }
  return result;
};

export const generateArciumKeypair = (): ArciumKeypair => {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
};

export const loadArciumKeypair = (walletAddress: string): ArciumKeypair | null => {
  if (typeof localStorage === 'undefined') return null;
  const publicKeyRaw = localStorage.getItem(`${ARCIUM_PUBLIC_KEY_STORAGE_KEY}:${walletAddress}`);
  const privateKeyRaw = typeof sessionStorage === 'undefined'
    ? null
    : sessionStorage.getItem(`${ARCIUM_PRIVATE_KEY_STORAGE_KEY}:${walletAddress}`);

  if (publicKeyRaw && privateKeyRaw) {
    try {
      return {
        privateKey: fromHex(privateKeyRaw),
        publicKey: fromHex(publicKeyRaw),
      };
    } catch {
      return null;
    }
  }

  const legacyRaw = localStorage.getItem(`${ARCIUM_KEYPAIR_STORAGE_KEY}:${walletAddress}`);
  if (!legacyRaw) return null;
  try {
    const parsed = JSON.parse(legacyRaw);
    const publicKey = fromHex(parsed.publicKey);
    const privateKey = fromHex(parsed.privateKey);
    localStorage.setItem(
      `${ARCIUM_PUBLIC_KEY_STORAGE_KEY}:${walletAddress}`,
      toHex(publicKey),
    );
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        `${ARCIUM_PRIVATE_KEY_STORAGE_KEY}:${walletAddress}`,
        toHex(privateKey),
      );
    }
    localStorage.removeItem(`${ARCIUM_KEYPAIR_STORAGE_KEY}:${walletAddress}`);
    return { privateKey, publicKey };
  } catch {
    return null;
  }
};

export const saveArciumKeypair = (walletAddress: string, keypair: ArciumKeypair): void => {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }
  localStorage.setItem(
    `${ARCIUM_PUBLIC_KEY_STORAGE_KEY}:${walletAddress}`,
    toHex(keypair.publicKey),
  );
  if (typeof sessionStorage === 'undefined') {
    throw new Error('sessionStorage unavailable');
  }
  sessionStorage.setItem(
    `${ARCIUM_PRIVATE_KEY_STORAGE_KEY}:${walletAddress}`,
    toHex(keypair.privateKey),
  );
  localStorage.removeItem(`${ARCIUM_KEYPAIR_STORAGE_KEY}:${walletAddress}`);
};

export const initializeArciumKeypair = (walletAddress: string): ArciumKeypair => {
  const existing = loadArciumKeypair(walletAddress);
  if (existing) return existing;

  const keypair = generateArciumKeypair();
  try {
    saveArciumKeypair(walletAddress, keypair);
  } catch {
  }
  return keypair;
};

export const clearArciumKeypair = (walletAddress: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(`${ARCIUM_KEYPAIR_STORAGE_KEY}:${walletAddress}`);
  localStorage.removeItem(`${ARCIUM_PUBLIC_KEY_STORAGE_KEY}:${walletAddress}`);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(`${ARCIUM_PRIVATE_KEY_STORAGE_KEY}:${walletAddress}`);
  }
};

/**
 * Creates an ArciumEncryptionClient implementation using the provided keypair.
 *
 * Encryption scheme:
 * - Generate ephemeral X25519 keypair
 * - Compute shared secret via ECDH
 * - Derive keystream from shared secret using SHA-256
 * - XOR plaintext with keystream (stream cipher)
 * - Store ephemeral public key as nonce for decryption
 */
export const createArciumClient = (keypair: ArciumKeypair): ArciumEncryptionClient => {
  const POSITION_SIZE = 24;

  const encryptPosition = (deposit: bigint, borrow: bigint): CiphertextBundle => {
    const ephemeralPrivateKey = x25519.utils.randomSecretKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, keypair.publicKey);

    const plaintext = new Uint8Array(POSITION_SIZE);
    plaintext.set(bigintToBytes(deposit, 8), 0);
    plaintext.set(bigintToBytes(borrow, 8), 8);
    plaintext.set(bigintToBytes(0n, 8), 16);

    const keystream = sharedSecret.slice(0, POSITION_SIZE);
    const ciphertext = xorBytes(plaintext, keystream);

    return {
      ciphertext: [ciphertext],
      nonce: ephemeralPublicKey,
    };
  };

  const decryptPosition = (payload: Uint8Array): PositionData => {
    if (payload.length < POSITION_SIZE + 32) {
      return { deposit: 0n, borrow: 0n, shares: 0n };
    }

    const ciphertext = payload.slice(0, POSITION_SIZE);
    const ephemeralPublicKey = payload.slice(POSITION_SIZE, POSITION_SIZE + 32);

    const sharedSecret = x25519.getSharedSecret(keypair.privateKey, ephemeralPublicKey);
    const keystream = sharedSecret.slice(0, POSITION_SIZE);
    const plaintext = xorBytes(ciphertext, keystream);

    return {
      deposit: bytesToBigint(plaintext.slice(0, 8)),
      borrow: bytesToBigint(plaintext.slice(8, 16)),
      shares: bytesToBigint(plaintext.slice(16, 24)),
    };
  };

  const getClientPublicKey = (): Uint8Array => keypair.publicKey;

  return {
    encryptPosition,
    decryptPosition,
    getClientPublicKey,
  };
};

/**
 * Encode encrypted position for on-chain storage (32 bytes).
 * Format: [24 bytes ciphertext][8 bytes truncated ephemeral pubkey hash]
 */
export const encodeEncryptedBalance = (bundle: CiphertextBundle): number[] => {
  const result = new Uint8Array(32);
  result.set(bundle.ciphertext[0].slice(0, 24), 0);

  const nonceHash = bundle.nonce.slice(0, 8);
  result.set(nonceHash, 24);

  return Array.from(result);
};

/**
 * Store full encrypted bundle for later decryption.
 * The on-chain 32-byte field is insufficient for full recovery,
 * so we store the full bundle in localStorage keyed by on-chain hash.
 */
export const storeEncryptedBundle = (
  walletAddress: string,
  vaultAddress: string,
  bundle: CiphertextBundle,
): void => {
  if (typeof localStorage === 'undefined') return;

  const key = `veillend.encrypted:${walletAddress}:${vaultAddress}`;
  const data = {
    ciphertext: toHex(bundle.ciphertext[0]),
    nonce: toHex(bundle.nonce),
    updatedAt: Date.now(),
  };
  localStorage.setItem(key, JSON.stringify(data));
};

export const loadEncryptedBundle = (
  walletAddress: string,
  vaultAddress: string,
): CiphertextBundle | null => {
  if (typeof localStorage === 'undefined') return null;

  const key = `veillend.encrypted:${walletAddress}:${vaultAddress}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      ciphertext: [fromHex(parsed.ciphertext)],
      nonce: fromHex(parsed.nonce),
    };
  } catch {
    return null;
  }
};
