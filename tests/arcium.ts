import { expect } from 'chai';
import {
  createArciumClient,
  encodeEncryptedBalance,
  generateArciumKeypair,
} from '../src/sdk/arcium';

describe('Arcium SDK', () => {
  it('encrypts and decrypts position data', () => {
    const keypair = generateArciumKeypair();
    const client = createArciumClient(keypair);
    const bundle = client.encryptPosition(42n, 7n);
    const payload = new Uint8Array([...bundle.ciphertext[0], ...bundle.nonce]);
    const decoded = client.decryptPosition(payload);

    expect(decoded.deposit).to.equal(42n);
    expect(decoded.borrow).to.equal(7n);
  });

  it('encodes encrypted balance for on-chain storage', () => {
    const keypair = generateArciumKeypair();
    const client = createArciumClient(keypair);
    const bundle = client.encryptPosition(10n, 0n);
    const encoded = encodeEncryptedBalance(bundle);

    expect(encoded).to.have.length(32);
    expect(encoded.slice(0, 24)).to.deep.equal(Array.from(bundle.ciphertext[0].slice(0, 24)));
    expect(encoded.slice(24, 32)).to.deep.equal(Array.from(bundle.nonce.slice(0, 8)));
  });
});
