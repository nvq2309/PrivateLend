declare module 'snarkjs' {
  export const groth16: {
    fullProve: (
      input: Record<string, unknown>,
      wasm: string | ArrayBuffer,
      zkey: string | ArrayBuffer,
    ) => Promise<{ proof: unknown; publicSignals: string[] }>;
    verify: (
      vkey: Record<string, unknown>,
      publicSignals: string[],
      proof: unknown,
    ) => Promise<boolean>;
  };
}
