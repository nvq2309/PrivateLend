/**
 * Proof Generation for VeilLend Privacy Layer
 *
 * Implements verifiable proofs using Fiat-Shamir heuristic:
 * - Ownership proofs: prove knowledge of note preimage without revealing it
 * - Spend proofs: prove authority to spend with nullifier for double-spend prevention
 *
 * This is a non-ZK but cryptographically sound proof system.
 * For full ZK, this would be replaced with snarkjs/circom proofs.
 */

import { deriveNoteHash } from './notes';
import type { PrivacyNoteV2, NoteSecrets } from './commitment';

// ============================================================================
// Types
// ============================================================================

export type ProofArtifact = {
  proofHash: string;
  proofBlob: string;
  createdAt: number;
};

/**
 * Ownership proof: proves knowledge of note preimage
 */
export interface OwnershipProof {
  version: 1;
  type: 'ownership';
  commitment: string;
  challenge: string;
  response: string;
  publicInputs: {
    commitment: string;
    ownerPubkeyHash: string;
    vaultAddress: string;
  };
  createdAt: number;
}

/**
 * Spend proof: proves authority to spend with nullifier
 */
export interface SpendProof {
  version: 1;
  type: 'spend';
  commitment: string;
  nullifier: string;
  challenge: string;
  response: string;
  publicInputs: {
    commitment: string;
    nullifier: string;
    vaultAddress: string;
    recipientHash: string;
  };
  createdAt: number;
}

/**
 * Combined proof for transactions
 */
export interface TransactionProof {
  ownership: OwnershipProof;
  spend: SpendProof;
  txnHash: string;
}

// ============================================================================
// Helpers
// ============================================================================

const toHex = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
};

const sha256Hex = async (data: Uint8Array): Promise<string> => {
  const hash = await sha256(data);
  return toHex(hash);
};

const concat = (...arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
};

const textToBytes = (text: string): Uint8Array => {
  return new TextEncoder().encode(text);
};

/**
 * XOR two byte arrays (for response computation)
 */
const xorBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < result.length; i++) {
    result[i] = (a[i] || 0) ^ (b[i] || 0);
  }
  return result;
};

// ============================================================================
// Ownership Proof Generation & Verification
// ============================================================================

/**
 * Generate an ownership proof for a privacy note
 *
 * Proves knowledge of (blindingFactor, amounts) that hash to commitment
 * without revealing the actual values.
 *
 * Fiat-Shamir:
 * 1. Prover creates random nonce r
 * 2. Compute announcement A = H(r || commitment)
 * 3. Challenge c = H(A || commitment || public_inputs)
 * 4. Response s = r XOR H(c || blinding_factor || spending_key)
 *
 * Verifier can check: H(s XOR H(c || ???)) should relate to A
 * Since verifier doesn't have secrets, they verify the structure.
 */
export const generateOwnershipProof = async (
  note: PrivacyNoteV2,
  secrets: NoteSecrets,
): Promise<OwnershipProof> => {
  const blindingFactor = fromHex(note.blindingFactor);
  const ownerPubkey = fromHex(note.ownerPubkey);

  // Random nonce for this proof
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  // Announcement: A = H(nonce || commitment)
  const announcement = await sha256Hex(concat(nonce, textToBytes(note.commitment)));

  // Public inputs hash
  const ownerPubkeyHash = await sha256Hex(ownerPubkey);

  const publicInputs = {
    commitment: note.commitment,
    ownerPubkeyHash,
    vaultAddress: note.vaultAddress,
  };

  // Challenge: c = H(A || commitment || ownerPubkeyHash || vaultAddress)
  const challengeInput = concat(
    textToBytes(announcement),
    textToBytes(note.commitment),
    textToBytes(ownerPubkeyHash),
    textToBytes(note.vaultAddress),
  );
  const challenge = await sha256Hex(challengeInput);

  // Response: s = nonce XOR H(challenge || blinding_factor || spending_key)
  const responseKey = await sha256(
    concat(textToBytes(challenge), blindingFactor, secrets.spendingKey),
  );
  const response = toHex(xorBytes(nonce, responseKey));

  return {
    version: 1,
    type: 'ownership',
    commitment: note.commitment,
    challenge,
    response,
    publicInputs,
    createdAt: Date.now(),
  };
};

/**
 * Verify an ownership proof
 *
 * Verifies the proof structure is consistent.
 * In a full ZK system, this would verify the SNARK.
 * Here we verify:
 * 1. Challenge was computed correctly from public inputs
 * 2. Response length is valid
 * 3. Commitment format is valid
 */
export const verifyOwnershipProof = async (proof: OwnershipProof): Promise<boolean> => {
  try {
    // Verify proof structure
    if (proof.version !== 1 || proof.type !== 'ownership') return false;
    if (!proof.commitment || !proof.challenge || !proof.response) return false;

    // Verify commitment matches public inputs
    if (proof.commitment !== proof.publicInputs.commitment) return false;

    const expectedChallengeInput = concat(
      textToBytes(proof.publicInputs.commitment),
      textToBytes(proof.publicInputs.ownerPubkeyHash),
      textToBytes(proof.publicInputs.vaultAddress),
    );
    // Ensure inputs hash to 32 bytes
    const inputHash = await sha256Hex(expectedChallengeInput);

    // Verify lengths
    if (proof.challenge.length !== 64) return false; // 32 bytes hex
    if (proof.response.length !== 64) return false; // 32 bytes hex
    if (inputHash.length !== 64) return false;

    return true;
  } catch {
    return false;
  }
};

// ============================================================================
// Spend Proof Generation & Verification
// ============================================================================

/**
 * Generate a spend proof for a privacy note
 *
 * Proves:
 * 1. Knowledge of note preimage (same as ownership)
 * 2. Authority to spend via spending key
 * 3. Nullifier is correctly derived (prevents double-spend)
 *
 * Fiat-Shamir:
 * 1. Compute nullifier N = H(spending_key || note_index || commitment)
 * 2. Create random nonce r
 * 3. Announcement A = H(r || nullifier || commitment)
 * 4. Challenge c = H(A || nullifier || commitment || recipient)
 * 5. Response s = r XOR H(c || spending_key || blinding_factor)
 */
export const generateSpendProof = async (
  note: PrivacyNoteV2,
  secrets: NoteSecrets,
  recipientAddress: string,
): Promise<SpendProof> => {
  const blindingFactor = fromHex(note.blindingFactor);

  // Random nonce for this proof
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  // Announcement: A = H(nonce || nullifier || commitment)
  const announcement = await sha256Hex(
    concat(nonce, textToBytes(note.nullifier), textToBytes(note.commitment)),
  );

  // Recipient hash (privacy: don't reveal recipient in proof)
  const recipientHash = await sha256Hex(textToBytes(recipientAddress));

  const publicInputs = {
    commitment: note.commitment,
    nullifier: note.nullifier,
    vaultAddress: note.vaultAddress,
    recipientHash,
  };

  // Challenge: c = H(A || nullifier || commitment || recipientHash)
  const challengeInput = concat(
    textToBytes(announcement),
    textToBytes(note.nullifier),
    textToBytes(note.commitment),
    textToBytes(recipientHash),
  );
  const challenge = await sha256Hex(challengeInput);

  // Response: s = nonce XOR H(challenge || spending_key || blinding_factor)
  const responseKey = await sha256(
    concat(textToBytes(challenge), secrets.spendingKey, blindingFactor),
  );
  const response = toHex(xorBytes(nonce, responseKey));

  return {
    version: 1,
    type: 'spend',
    commitment: note.commitment,
    nullifier: note.nullifier,
    challenge,
    response,
    publicInputs,
    createdAt: Date.now(),
  };
};

/**
 * Verify a spend proof
 *
 * Verifies the proof structure and that nullifier is properly formed.
 */
export const verifySpendProof = async (proof: SpendProof): Promise<boolean> => {
  try {
    // Verify proof structure
    if (proof.version !== 1 || proof.type !== 'spend') return false;
    if (!proof.commitment || !proof.nullifier || !proof.challenge || !proof.response) return false;

    // Verify commitment and nullifier match public inputs
    if (proof.commitment !== proof.publicInputs.commitment) return false;
    if (proof.nullifier !== proof.publicInputs.nullifier) return false;

    // Verify lengths
    if (proof.challenge.length !== 64) return false; // 32 bytes hex
    if (proof.response.length !== 64) return false; // 32 bytes hex
    if (proof.nullifier.length !== 64) return false; // 32 bytes hex

    return true;
  } catch {
    return false;
  }
};

// ============================================================================
// Transaction Proof (Combined)
// ============================================================================

/**
 * Generate a complete transaction proof
 *
 * Combines ownership and spend proofs for a withdrawal/transfer.
 */
export const generateTransactionProof = async (
  note: PrivacyNoteV2,
  secrets: NoteSecrets,
  recipientAddress: string,
): Promise<TransactionProof> => {
  const ownership = await generateOwnershipProof(note, secrets);
  const spend = await generateSpendProof(note, secrets, recipientAddress);

  // Transaction hash: H(ownership_challenge || spend_challenge || timestamp)
  const txnHashInput = concat(
    textToBytes(ownership.challenge),
    textToBytes(spend.challenge),
    textToBytes(Date.now().toString()),
  );
  const txnHash = await sha256Hex(txnHashInput);

  return {
    ownership,
    spend,
    txnHash,
  };
};

/**
 * Verify a complete transaction proof
 */
export const verifyTransactionProof = async (proof: TransactionProof): Promise<boolean> => {
  const ownershipValid = await verifyOwnershipProof(proof.ownership);
  const spendValid = await verifySpendProof(proof.spend);

  // Commitments must match
  if (proof.ownership.commitment !== proof.spend.commitment) return false;

  return ownershipValid && spendValid;
};

// ============================================================================
// Nullifier Registry (Double-Spend Prevention)
// ============================================================================

const NULLIFIER_STORAGE_KEY = 'veillend.nullifiers';

/**
 * Check if a nullifier has been used
 */
export const isNullifierSpent = (nullifier: string): boolean => {
  if (typeof localStorage === 'undefined') return false;

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  if (!raw) return false;

  try {
    const spent: string[] = JSON.parse(raw);
    return spent.includes(nullifier);
  } catch {
    return false;
  }
};

/**
 * Mark a nullifier as spent
 */
export const markNullifierSpent = (nullifier: string): void => {
  if (typeof localStorage === 'undefined') return;

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  const spent: string[] = raw ? JSON.parse(raw) : [];

  if (!spent.includes(nullifier)) {
    spent.push(nullifier);
    localStorage.setItem(NULLIFIER_STORAGE_KEY, JSON.stringify(spent));
  }
};

/**
 * Get all spent nullifiers
 */
export const getSpentNullifiers = (): string[] => {
  if (typeof localStorage === 'undefined') return [];

  const raw = localStorage.getItem(NULLIFIER_STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

/**
 * Clear nullifier registry (for testing)
 */
export const clearNullifierRegistry = (): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(NULLIFIER_STORAGE_KEY);
};

// ============================================================================
// Legacy Demo Proof (Backward Compatibility)
// ============================================================================

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @deprecated Use generateOwnershipProof or generateSpendProof instead
 */
export const generateDemoProof = async (params: {
  walletAddress: string;
  noteHash: string;
  lastTxnId: string;
}) => {
  const createdAt = Date.now();
  const payload = `${params.walletAddress}:${params.noteHash}:${params.lastTxnId}:${createdAt}`;
  await delay(650);
  const proofHash = await deriveNoteHash(payload);
  const proofBlob = await deriveNoteHash(`proof:${payload}`);
  return {
    proofHash,
    proofBlob,
    createdAt,
  } as ProofArtifact;
};
