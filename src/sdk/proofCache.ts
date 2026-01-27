import type { ZkAction } from './zkProof';

export type ProofCacheRecord = {
  proof: {
    aX: number[];
    aY: number[];
    bX0: number[];
    bX1: number[];
    bY0: number[];
    bY1: number[];
    cX: number[];
    cY: number[];
  };
  publicSignals: string[];
  rawProof?: unknown;
};

type ArtifactManifest = {
  generatedAt?: string;
  actions?: Record<string, { wasm?: string; zkey?: string; version?: string }>;
};

const CACHE_PREFIX = 'veillend.zkproof.cache';
const VERSION_PREFIX = 'veillend.zkproof.version';
const memoryCache = new Map<string, ProofCacheRecord>();
const memoryVersions = new Map<string, string>();
let manifestPromise: Promise<ArtifactManifest | null> | null = null;

const isBrowser = () => typeof window !== 'undefined' && typeof window.document !== 'undefined';

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
};

const stableStringify = (value: unknown) => JSON.stringify(normalize(value));

const hashBytes = async (data: Uint8Array): Promise<string> => {
  if (globalThis.crypto?.subtle) {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  const { createHash } = await import('crypto');
  return createHash('sha256').update(Buffer.from(data)).digest('hex');
};

const hashString = async (value: string): Promise<string> => {
  const encoder = new TextEncoder();
  return hashBytes(encoder.encode(value));
};

const loadManifest = async (): Promise<ArtifactManifest | null> => {
  if (manifestPromise) {
    return manifestPromise;
  }
  manifestPromise = (async () => {
    try {
      if (isBrowser()) {
        const response = await fetch('/zk/manifest.json', { cache: 'no-store' });
        if (!response.ok) return null;
        return (await response.json()) as ArtifactManifest;
      }
      const { readFile } = await import('fs/promises');
      const path = await import('path');
      const manifestPath = path.resolve(process.cwd(), 'public/zk/manifest.json');
      const raw = await readFile(manifestPath, 'utf8');
      return JSON.parse(raw) as ArtifactManifest;
    } catch {
      return null;
    }
  })();
  return manifestPromise;
};

const reconcileVersion = (action: ZkAction, version: string) => {
  if (isBrowser() && typeof localStorage !== 'undefined') {
    const versionKey = `${VERSION_PREFIX}:${action}`;
    const storedVersion = localStorage.getItem(versionKey);
    if (storedVersion && storedVersion !== version) {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${CACHE_PREFIX}:${action}:`)) {
          localStorage.removeItem(key);
        }
      }
    }
    localStorage.setItem(versionKey, version);
    return;
  }

  const storedVersion = memoryVersions.get(action);
  if (storedVersion && storedVersion !== version) {
    for (const key of memoryCache.keys()) {
      if (key.startsWith(`${CACHE_PREFIX}:${action}:`)) {
        memoryCache.delete(key);
      }
    }
  }
  memoryVersions.set(action, version);
};

export const hashZkInputs = async (input: Record<string, unknown>): Promise<string> => {
  return hashString(stableStringify(input));
};

export const buildProofCacheKey = (
  action: ZkAction,
  artifactVersion: string,
  inputHash: string,
): string => `${CACHE_PREFIX}:${action}:${artifactVersion}:${inputHash}`;

export const getArtifactVersion = async (action: ZkAction): Promise<string> => {
  const manifest = await loadManifest();
  const entry = manifest?.actions?.[action];
  const version = entry?.version ?? (entry ? `${entry.wasm ?? 'none'}:${entry.zkey ?? 'none'}` : 'local-dev');
  reconcileVersion(action, version);
  return version;
};

export const getProofCacheKey = async (
  action: ZkAction,
  input: Record<string, unknown>,
): Promise<string> => {
  const [inputHash, artifactVersion] = await Promise.all([
    hashZkInputs(input),
    getArtifactVersion(action),
  ]);
  return buildProofCacheKey(action, artifactVersion, inputHash);
};

export const getCachedProof = async (
  action: ZkAction,
  input: Record<string, unknown>,
): Promise<ProofCacheRecord | null> => {
  const key = await getProofCacheKey(action, input);
  if (isBrowser() && typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ProofCacheRecord;
    } catch {
      return null;
    }
  }
  return memoryCache.get(key) ?? null;
};

export const setCachedProof = async (
  action: ZkAction,
  input: Record<string, unknown>,
  record: ProofCacheRecord,
): Promise<void> => {
  const key = await getProofCacheKey(action, input);
  if (isBrowser() && typeof localStorage !== 'undefined') {
    const payload = JSON.stringify({ proof: record.proof, publicSignals: record.publicSignals });
    localStorage.setItem(key, payload);
    return;
  }
  memoryCache.set(key, record);
};

export const clearProofCache = (): void => {
  if (isBrowser() && typeof localStorage !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(VERSION_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    return;
  }
  memoryCache.clear();
  memoryVersions.clear();
};
