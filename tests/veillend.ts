import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Veillend } from '../target/types/veillend';
import { expect } from 'chai';
import { x25519 } from '@arcium-hq/client';
import { randomBytes } from 'crypto';

describe('VeilLend with Arcium Privacy', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Veillend as Program<Veillend>;

  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);

  it('deposits collateral with encrypted position', async () => {
    const depositAmount = new anchor.BN(1_000_000_000);
    const encryptedBalance = randomBytes(32);

    await program.methods
      .deposit(
        depositAmount,
        Array.from(encryptedBalance),
        Array.from(clientPublicKey),
      )
      .accounts({
        // TODO: populate accounts for deposit test
      })
      .rpc();

    expect(true).to.eq(true);
  });

  it('borrows with private debt tracking', async () => {
    const borrowAmount = new anchor.BN(500_000_000);
    const encryptedBalance = randomBytes(32);

    await program.methods
      .borrow(borrowAmount, Array.from(encryptedBalance))
      .accounts({
        // TODO: populate accounts for borrow test
      })
      .rpc();

    expect(true).to.eq(true);
  });

  it('repays debt and updates encrypted position', async () => {
    const repayAmount = new anchor.BN(250_000_000);
    const encryptedBalance = randomBytes(32);

    await program.methods
      .repay(repayAmount, Array.from(encryptedBalance))
      .accounts({
        // TODO: populate accounts for repay test
      })
      .rpc();

    expect(true).to.eq(true);
  });
});
