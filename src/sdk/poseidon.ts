let poseidonPromise: Promise<any> | null = null;

const getPoseidon = async () => {
  if (!poseidonPromise) {
    poseidonPromise = import('circomlibjs').then((lib) => lib.buildPoseidon());
  }
  return poseidonPromise;
};

export const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
};

export const bigintToBytesBE = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
};

export const poseidonHash = async (inputs: bigint[]): Promise<bigint> => {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  return poseidon.F.toObject(hash) as bigint;
};

export const poseidonHashBytes = async (inputs: Uint8Array[]): Promise<Uint8Array> => {
  const bigints = inputs.map((input) => bytesToBigIntBE(input));
  const hashed = await poseidonHash(bigints);
  return bigintToBytesBE(hashed, 32);
};
