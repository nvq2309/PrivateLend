import fs from 'fs';
import path from 'path';

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { getTotalBalance, savePrivacyNotes, type PrivacyNoteV2 } from '../../src/sdk/commitment';

const getStoredNote = async (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('veillend.note:'));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  });

const waitForTestWallet = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as any).__VEILLEND_TEST_WALLET__));
};

const readClipboard = async (page: Page) =>
  page.evaluate(() => (window as any).__VEILLEND_TEST_CLIPBOARD__ ?? '');

const getStoredWalletAddress = async (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith('veillend.note:'));
    return key ? key.replace('veillend.note:', '') : null;
  });

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const loadDotEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {} as Record<string, string>;
  const raw = fs.readFileSync(envPath, 'utf8');
  const entries = raw.split('\n');
  const values: Record<string, string> = {};

  for (const line of entries) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"|"$/g, '');
    if (key) {
      values[key] = value;
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  return values;
};

const envValues = loadDotEnv();
const readEnv = (key: string) => envValues[key] ?? process.env[key];
const decodeBase58 = (input: string): Uint8Array => {
  let value = 0n;
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    value = value * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value % 256n));
    value /= 256n;
  }
  bytes.reverse();

  const leadingZeros = input.match(/^1+/)?.[0].length ?? 0;
  return new Uint8Array([...Array(leadingZeros).fill(0), ...bytes]);
};

const WALLET_1_PUBLIC_KEY = readEnv('E2E_WALLET_1_PUBLIC_KEY') ?? readEnv('PUBLIC_KEY');
const WALLET_1_PRIVATE_KEY = readEnv('E2E_WALLET_1_PRIVATE_KEY') ?? readEnv('USER_WALLET_PRIVATE_KEY');
const WALLET_2_PUBLIC_KEY = readEnv('E2E_WALLET_2_PUBLIC_KEY');
const WALLET_2_PRIVATE_KEY = readEnv('E2E_WALLET_2_PRIVATE_KEY');
const WALLET_1_SECRET = WALLET_1_PRIVATE_KEY ? decodeBase58(WALLET_1_PRIVATE_KEY) : null;

const seedPrivacyNotes = async (page: Page, walletAddress: string, notes: any[]) => {
  await page.evaluate(({ payload, wallet }) => {
    localStorage.setItem(`veillend.privacy_note.v2:${wallet}`, JSON.stringify(payload));
    localStorage.setItem(
      `veillend.secrets:${wallet}`,
      JSON.stringify({
        blindingFactor: 'ab'.repeat(32),
        spendingKey: 'cd'.repeat(32),
      }),
    );
  }, { payload: notes, wallet: walletAddress });
};

const initE2ePage = async (
  page: Page,
  walletSecret?: number[],
  walletPublicKey?: string,
  balances?: {
    walletBalanceLamports?: number;
    collateralBalanceLamports?: number;
    borrowBalanceLamports?: number;
    usdcBalanceLamports?: number;
  },
  useRealMax?: boolean,
  preserveStorage?: boolean,
) => {
  const resolvedSecret = walletSecret ?? (WALLET_1_SECRET ? Array.from(WALLET_1_SECRET) : null);
  const resolvedPublicKey = walletPublicKey ?? WALLET_1_PUBLIC_KEY ?? null;
  await page.addInitScript(({ secret, publicKey, e2eBalances, realMax, preserve }) => {
    if (!preserve) {
      localStorage.clear();
    }
    (window as any).__VEILLEND_TEST_CLIPBOARD__ = '';
    if (secret) {
      (window as any).__VEILLEND_E2E_WALLET_SECRET__ = secret;
    }
    if (publicKey) {
      (window as any).__VEILLEND_E2E_WALLET_PUBLIC_KEY__ = publicKey;
    }
    if (e2eBalances) {
      (window as any).__VEILLEND_E2E_BALANCES__ = e2eBalances;
    }
    if (realMax) {
      (window as any).__VEILLEND_E2E_USE_REAL_MAX__ = true;
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          (window as any).__VEILLEND_TEST_CLIPBOARD__ = text;
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  }, {
    secret: resolvedSecret,
    publicKey: resolvedPublicKey,
    e2eBalances: balances ?? null,
    realMax: useRealMax ?? false,
    preserve: preserveStorage ?? false,
  });
};

const snapshotStep = async (page: Page, testInfo: TestInfo, step: string) => {
  const saveToast = page.getByText('Note saved to storage & clipboard.');
  if (await saveToast.isVisible()) {
    await saveToast.waitFor({ state: 'hidden', timeout: 10000 });
  }
  await expect(page).toHaveScreenshot(`${testInfo.title}-${step}.png`, {
    fullPage: true,
    mask: [page.locator('[data-snapshot="dynamic"]')],
    maxDiffPixels: 200,
  });
};

const stepSnapshot = async (
  page: Page,
  testInfo: TestInfo,
  step: string,
  action: () => Promise<void>,
) => {
  await test.step(step, async () => {
    await action();
    await snapshotStep(page, testInfo, step);
  });
};

const runSecureAction = async (page: Page, label: string, amount: string) => {
  await openAction(page, label);
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('button', { name: 'Shield and Execute' }).click();
  await expect(page.getByRole('button', { name: 'Save to storage & clipboard' })).toBeVisible();
};

const runFastAction = async (page: Page, label: string, amount: string) => {
  await openAction(page, label);
  await page.getByRole('button', { name: 'Toggle mode' }).click();
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByText(/completed successfully\./)).toBeVisible();
};

const assertPositionTotals = async (page: Page, depositSol: string, borrowUsdc: string) => {
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();

  const positionSection = page.locator('section').filter({ hasText: 'Your Position' });
  await expect(positionSection).toContainText(new RegExp(`${depositSol}\\s*SOL`));
  await expect(positionSection).toContainText(new RegExp(`${borrowUsdc}\\s*USDC`));
};

const unlockVault = async (page: Page, testInfo: TestInfo, prefix = 'vault') => {
  await waitForTestWallet(page);
  await stepSnapshot(page, testInfo, `${prefix}-open-portfolio`, async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await expect(page.getByText('Private Vault Access').or(page.getByText('VAULT UNLOCKED'))).toBeVisible();
  });
  const gateVisible = await page.getByText('Private Vault Access').isVisible();
  if (gateVisible) {
    await stepSnapshot(page, testInfo, `${prefix}-generate-note`, async () => {
      await page.getByRole('button', { name: 'Generate Access Key' }).click();
      await expect(page.getByText('Your New Note')).toBeVisible();
    });
    await stepSnapshot(page, testInfo, `${prefix}-confirm-note`, async () => {
      await page.getByRole('button', { name: 'Confirm & Save' }).click();
      await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();
    });
  } else {
    await stepSnapshot(page, testInfo, `${prefix}-already-unlocked`, async () => {
      await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();
    });
  }
};

const openAction = async (page: Page, name: string, index = 0) => {
  await page.getByRole('button', { name }).nth(index).click();
  await expect(page.getByLabel('Amount')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    (window as any).__VEILLEND_TEST_CLIPBOARD__ = '';
    (window as any).__VEILLEND_E2E_BALANCES__ = undefined;
    (window as any).__VEILLEND_E2E_WALLET_PUBLIC_KEY__ = undefined;
    (window as any).__VEILLEND_E2E_WALLET_SECRET__ = undefined;
    (window as any).__VEILLEND_E2E_USE_REAL_MAX__ = undefined;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          (window as any).__VEILLEND_TEST_CLIPBOARD__ = text;
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });
});

test('renders markets dashboard', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'markets-dashboard', async () => {
    await page.goto('/?e2e=1');
    await expect(page.getByText('VeilLend Markets')).toBeVisible();
    await expect(page.getByText('Vault Collateral')).toBeVisible();
  });
});

test('portfolio gate creates and stores an initial note', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open-portfolio', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'gate');
  await stepSnapshot(page, testInfo, 'note-stored', async () => {
    const note = await getStoredNote(page);
    expect(note?.noteHash).toBeTruthy();
  });
  await stepSnapshot(page, testInfo, 'lock-vault', async () => {
    await page.getByRole('button', { name: 'Lock Vault' }).click();
    await expect(page.getByText('Private Vault Access')).toBeVisible();
  });
});

test('secure supply creates proof and rotates note', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'secure-supply');
  const initialNote = await getStoredNote(page);

  await stepSnapshot(page, testInfo, 'secure-supply-submit', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 0);
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Shield and Execute' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-supply-proof', async () => {
  await expect(page.getByText('Proof signals')).toBeVisible();
    await expect(page.getByText('New note')).toBeVisible();
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-supply-rotated', async () => {
    const nextNote = await getStoredNote(page);
    expect(initialNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).not.toEqual(initialNote?.noteHash);
  });
});

test('secure actions require merkle tree readiness', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'merkle');
  await stepSnapshot(page, testInfo, 'merkle-ready', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 0);
    await page.getByLabel('Amount').fill('1');

    await expect(page.getByText('Merkle Tree Missing')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Shield and Execute' })).toBeEnabled();
  });
});

test('fast supply skips proof output', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'fast-supply');

  await stepSnapshot(page, testInfo, 'fast-supply-execute', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 0);
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Execute' }).click();

    await expect(page.getByText(/completed successfully\./)).toBeVisible();
  await expect(page.getByText('Proof signals')).toHaveCount(0);
  });
});

test('borrow parity for fast and secure', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'borrow-parity');

  await stepSnapshot(page, testInfo, 'borrow-secure', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await runSecureAction(page, 'Borrow', '1');
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await stepSnapshot(page, testInfo, 'borrow-fast', async () => {
    await runFastAction(page, 'Borrow', '1');
  });
});

test('repay parity for fast and secure', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'repay-parity');

  await stepSnapshot(page, testInfo, 'repay-secure', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await runSecureAction(page, 'Repay', '1');
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await stepSnapshot(page, testInfo, 'repay-fast', async () => {
    await runFastAction(page, 'Repay', '1');
  });
});

test('withdraw parity for fast and secure', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'withdraw-parity');

  await stepSnapshot(page, testInfo, 'withdraw-secure', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await runSecureAction(page, 'Withdraw', '1');
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await stepSnapshot(page, testInfo, 'withdraw-fast', async () => {
    await runFastAction(page, 'Withdraw', '1');
  });
});

test('secure supply USDC creates proof and rotates note', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'secure-usdc-supply');
  const initialNote = await getStoredNote(page);

  await stepSnapshot(page, testInfo, 'secure-usdc-submit', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 1);
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Shield and Execute' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-usdc-proof', async () => {
  await expect(page.getByText('Proof signals')).toBeVisible();
    await expect(page.getByText('New note')).toBeVisible();
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-usdc-rotated', async () => {
    const nextNote = await getStoredNote(page);
    expect(initialNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).not.toEqual(initialNote?.noteHash);
  });
});

test('fast supply USDC skips proof output', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'fast-usdc-supply');

  await stepSnapshot(page, testInfo, 'fast-usdc-execute', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 1);
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/completed successfully\./)).toBeVisible();
  await expect(page.getByText('Proof signals')).toHaveCount(0);
  });
});

test('secure borrow SOL creates proof and rotates note', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'secure-sol-borrow');
  const initialNote = await getStoredNote(page);

  await stepSnapshot(page, testInfo, 'secure-sol-borrow-submit', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Borrow', 0);
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Shield and Execute' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-sol-borrow-proof', async () => {
  await expect(page.getByText('Proof signals')).toBeVisible();
    await expect(page.getByText('New note')).toBeVisible();
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });

  await stepSnapshot(page, testInfo, 'secure-sol-borrow-rotated', async () => {
    const nextNote = await getStoredNote(page);
    expect(initialNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).toBeTruthy();
    expect(nextNote?.noteHash).not.toEqual(initialNote?.noteHash);
  });
});

test('fast borrow SOL skips proof output', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'fast-sol-borrow');

  await stepSnapshot(page, testInfo, 'fast-sol-borrow-execute', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Borrow', 0);
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/completed successfully\./)).toBeVisible();
  await expect(page.getByText('Proof signals')).toHaveCount(0);
  });
});

test('supply SOL exceeds max shows error', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'supply-sol-max');

  await stepSnapshot(page, testInfo, 'supply-sol-error', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 0);
    await page.getByLabel('Amount').fill('1000');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible();
  });
});

test('supply USDC exceeds max shows error', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'supply-usdc-max');

  await stepSnapshot(page, testInfo, 'supply-usdc-error', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 1);
    await page.getByLabel('Amount').fill('1000');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible();
  });
});

test('borrow USDC exceeds LTV shows error', async ({ page }, testInfo) => {
  await initE2ePage(page, undefined, undefined, undefined, true);
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'borrow-usdc-limit');
  const walletAddress = await getStoredWalletAddress(page);
  expect(walletAddress).toBeTruthy();
  await seedPrivacyNotes(page, walletAddress as string, [
    {
      version: 2,
      commitment: 'aa'.repeat(32),
      nullifier: 'bb'.repeat(32),
      blindingFactor: 'cc'.repeat(32),
      ownerPubkey: 'dd'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(1_000_000_000),
      borrowAmount: '0',
      noteIndex: 0,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page, testInfo, 'borrow-usdc-reload', async () => {
    await page.reload();
    await waitForTestWallet(page);
  });

  await unlockVault(page, testInfo, 'borrow-usdc-after-reload');

  await stepSnapshot(page, testInfo, 'borrow-usdc-error', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await openAction(page, 'Borrow USDC');
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1000');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible();
  });
});

test('borrow SOL exceeds LTV shows error', async ({ page }, testInfo) => {
  await initE2ePage(page, undefined, undefined, undefined, true);
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'borrow-sol-limit');
  const walletAddress = await getStoredWalletAddress(page);
  expect(walletAddress).toBeTruthy();
  await seedPrivacyNotes(page, walletAddress as string, [
    {
      version: 2,
      commitment: 'ee'.repeat(32),
      nullifier: 'ff'.repeat(32),
      blindingFactor: '11'.repeat(32),
      ownerPubkey: '22'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(1_000_000_000),
      borrowAmount: '0',
      noteIndex: 0,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page, testInfo, 'borrow-sol-reload', async () => {
    await page.reload();
    await waitForTestWallet(page);
    await expect(page.getByText('$145.20')).toBeVisible();
    await expect(page.getByText('6.5%')).toBeVisible();
  });

  await stepSnapshot(page, testInfo, 'borrow-sol-error', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Borrow', 0);
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1000');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible();
  });
});

test('repay without debt shows error', async ({ page }, testInfo) => {
  await initE2ePage(page, undefined, undefined, undefined, true);
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'repay-no-debt');

  await stepSnapshot(page, testInfo, 'repay-no-debt-error', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await openAction(page, 'Repay');
    await expect(page.getByRole('button', { name: /Max/ })).toContainText('Max 0.0000');
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible({ timeout: 10000 });
  });
});

test('repay exceeds max debt shows error', async ({ page }, testInfo) => {
  await initE2ePage(page, undefined, undefined, {
    borrowBalanceLamports: 5_000_000,
  }, true);
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'repay-max-debt');

  await stepSnapshot(page, testInfo, 'repay-max-error', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await openAction(page, 'Repay');
    await expect(page.getByRole('button', { name: /Max/ })).toContainText('Max 5.0000');
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('10');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible({ timeout: 10000 });
  });
});

test('withdraw exceeds max shows error', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'withdraw-max');

  await stepSnapshot(page, testInfo, 'withdraw-max-error', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await openAction(page, 'Withdraw');
    await page.getByRole('button', { name: 'Toggle mode' }).click();
    await page.getByLabel('Amount').fill('100');
    await page.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Amount exceeds maximum/)).toBeVisible();
  });
});

test('invalid note string shows error', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await waitForTestWallet(page);

  await stepSnapshot(page, testInfo, 'invalid-import', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
  await page.getByPlaceholder('Paste note string...').fill('{');
  await page.getByRole('button', { name: 'Unlock Vault' }).click();
  await expect(page.getByText('Invalid note string.')).toBeVisible();
});
});

test('note string import unlocks vault', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await waitForTestWallet(page);
  const noteHash = 'a'.repeat(64);
  await page.evaluate(({ noteHash }) => {
    localStorage.setItem(`veillend.note_access:${noteHash}`, JSON.stringify({
      version: 1,
      noteHash,
      lastTxnId: 'imported',
      privacyNotes: [],
      secrets: { blindingFactor: 'ab'.repeat(32), spendingKey: 'cd'.repeat(32) },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  }, { noteHash });

  await stepSnapshot(page, testInfo, 'note-hash-import', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
  await page.getByPlaceholder('Paste note string...').fill(noteHash);
    await page.getByRole('button', { name: 'Unlock Vault' }).click();
    await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();
  });
});

test('lock vault clears note and returns gate', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'lock-flow');
  await stepSnapshot(page, testInfo, 'lock-vault', async () => {
    await page.getByRole('button', { name: 'Lock Vault' }).click();
    await expect(page.getByText('Private Vault Access')).toBeVisible();
  });
});

test('note string export stores access record', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await unlockVault(page, testInfo, 'export');
  const walletAddress = await getStoredWalletAddress(page);
  expect(walletAddress).toBeTruthy();

  await stepSnapshot(page, testInfo, 'seed-notes', async () => {
    await seedPrivacyNotes(page, walletAddress as string, [
    {
      version: 2,
      commitment: 'aa'.repeat(32),
      nullifier: 'bb'.repeat(32),
      blindingFactor: 'cc'.repeat(32),
      ownerPubkey: 'dd'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: '1000',
      borrowAmount: '250',
      noteIndex: 0,
      createdAt: Date.now(),
      spent: false,
    },
    {
      version: 2,
      commitment: 'ee'.repeat(32),
      nullifier: 'ff'.repeat(32),
      blindingFactor: '11'.repeat(32),
      ownerPubkey: '22'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: '500',
      borrowAmount: '100',
      noteIndex: 1,
      createdAt: Date.now(),
      spent: false,
    },
    ]);
  });

  await stepSnapshot(page, testInfo, 'export-action', async () => {
    await page.getByRole('button', { name: 'Markets' }).click();
    await openAction(page, 'Supply', 0);
    await page.getByLabel('Amount').fill('1');
    await page.getByRole('button', { name: 'Shield and Execute' }).click();
    await expect(page.getByRole('button', { name: 'Save to storage & clipboard' })).toBeVisible();
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });

  await stepSnapshot(page, testInfo, 'export-clipboard', async () => {
    const noteString = await readClipboard(page);
    expect(noteString).toBeTruthy();
    const access = await page.evaluate((noteStringInput) => {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith('veillend.note_access:'));
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.noteString === noteStringInput) return parsed;
        } catch {
          continue;
        }
      }
      return null;
    }, noteString);
    expect(access?.noteString).toEqual(noteString);
    expect(access?.lastTxnId).toBeTruthy();
    expect(access?.secrets?.blindingFactor).toBeTruthy();
    expect(access?.secrets?.spendingKey).toBeTruthy();
    expect(access?.privacyNotes).toHaveLength(2);
  });
});

test('note string import restores notes from access record', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });
  await waitForTestWallet(page);
  const payload = {
    version: 1,
    noteHash: 'b'.repeat(64),
    lastTxnId: 'imported-tx',
    privacyNotes: [
      {
        version: 2,
        commitment: 'aa'.repeat(32),
        nullifier: 'bb'.repeat(32),
        blindingFactor: 'cc'.repeat(32),
        ownerPubkey: 'dd'.repeat(32),
        vaultAddress: 'vault-1',
        depositAmount: '800',
        borrowAmount: '120',
        noteIndex: 0,
        createdAt: Date.now(),
        spent: false,
      },
    ],
    secrets: { blindingFactor: 'ab'.repeat(32), spendingKey: 'cd'.repeat(32) },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await page.evaluate(({ payload }) => {
    localStorage.setItem(`veillend.note_access:${payload.noteHash}`, JSON.stringify(payload));
  }, { payload });

  await stepSnapshot(page, testInfo, 'import-note', async () => {
    await page.getByRole('button', { name: 'Portfolio' }).click();
  await page.getByPlaceholder('Paste note string...').fill(payload.noteHash);
    await page.getByRole('button', { name: 'Unlock Vault' }).click();
    await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();
  });

  const stored = await page.evaluate(() => {
    const noteKey = Object.keys(localStorage).find((item) => item.startsWith('veillend.note:'));
    const wallet = noteKey ? noteKey.replace('veillend.note:', '') : null;
    const noteRaw = wallet ? localStorage.getItem(`veillend.note:${wallet}`) : null;
    const notesRaw = wallet ? localStorage.getItem(`veillend.privacy_note.v2:${wallet}`) : null;
    return {
      note: noteRaw ? JSON.parse(noteRaw) : null,
      notes: notesRaw ? JSON.parse(notesRaw) : [],
    };
  });

  await stepSnapshot(page, testInfo, 'import-storage', async () => {
    expect(stored.note?.noteHash).toEqual(payload.noteHash);
    expect(stored.notes).toHaveLength(1);
  });
});

test('privacy note aggregation sums totals client-side', async ({ page }, testInfo) => {
  await stepSnapshot(page, testInfo, 'open', async () => {
    await page.goto('/?e2e=1');
  });

  const wallet = 'aggregation-wallet';
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });

  const notes: PrivacyNoteV2[] = [
    {
      version: 2,
      commitment: 'aa'.repeat(32),
      nullifier: 'bb'.repeat(32),
      blindingFactor: 'cc'.repeat(32),
      ownerPubkey: 'dd'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: '1000',
      borrowAmount: '200',
      noteIndex: 0,
      createdAt: Date.now(),
      spent: false,
    },
    {
      version: 2,
      commitment: 'ee'.repeat(32),
      nullifier: 'ff'.repeat(32),
      blindingFactor: '11'.repeat(32),
      ownerPubkey: '22'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: '500',
      borrowAmount: '300',
      noteIndex: 1,
      createdAt: Date.now(),
      spent: false,
    },
  ];

  savePrivacyNotes(wallet, notes);
  const totals = getTotalBalance(wallet);

  await stepSnapshot(page, testInfo, 'aggregate-totals', async () => {
    expect(totals.deposit.toString()).toEqual('1500');
    expect(totals.borrow.toString()).toEqual('500');
  });
});

test('two wallets share note and position state', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  if (!WALLET_1_PUBLIC_KEY || !WALLET_1_PRIVATE_KEY) {
    throw new Error('Missing E2E_WALLET_1_PUBLIC_KEY or E2E_WALLET_1_PRIVATE_KEY in .env');
  }
  if (!WALLET_2_PUBLIC_KEY || !WALLET_2_PRIVATE_KEY) {
    throw new Error('Missing E2E_WALLET_2_PUBLIC_KEY or E2E_WALLET_2_PRIVATE_KEY in .env');
  }
  const wallet2Secret = decodeBase58(WALLET_2_PRIVATE_KEY);
  if (wallet2Secret.length !== 64) {
    throw new Error('Wallet 2 secret key must be 64 bytes');
  }

  const page1 = await browser.newPage();
  await initE2ePage(page1);
  await stepSnapshot(page1, testInfo, 'wallet1-open', async () => {
    await page1.goto('/?e2e=1');
  });
  await unlockVault(page1, testInfo, 'wallet1');

  const wallet1Address = await getStoredWalletAddress(page1);
  expect(wallet1Address).toBeTruthy();
  const wallet1Note = await getStoredNote(page1);
  expect(wallet1Note?.noteHash).toBeTruthy();

  await stepSnapshot(page1, testInfo, 'wallet1-supply', async () => {
    await page1.getByRole('button', { name: 'Markets' }).click();
    await runSecureAction(page1, 'Supply', '1');
  });
  await seedPrivacyNotes(page1, wallet1Address as string, [
    {
      version: 2,
      commitment: '11'.repeat(32),
      nullifier: '22'.repeat(32),
      blindingFactor: '33'.repeat(32),
      ownerPubkey: '44'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(1_000_000_000),
      borrowAmount: '0',
      noteIndex: 0,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page1, testInfo, 'wallet1-supply-save', async () => {
    await page1.getByRole('button', { name: 'Save to storage & clipboard' }).click();
    const afterSupply = await getStoredNote(page1);
    expect(afterSupply?.noteHash).not.toEqual(wallet1Note?.noteHash);
  });
  await assertPositionTotals(page1, '1', '0');

  await stepSnapshot(page1, testInfo, 'wallet1-borrow', async () => {
    await page1.getByRole('button', { name: 'Markets' }).click();
    await runSecureAction(page1, 'Borrow', '10');
  });
  await seedPrivacyNotes(page1, wallet1Address as string, [
    {
      version: 2,
      commitment: '55'.repeat(32),
      nullifier: '66'.repeat(32),
      blindingFactor: '77'.repeat(32),
      ownerPubkey: '88'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(1_000_000_000),
      borrowAmount: String(10_000_000),
      noteIndex: 1,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page1, testInfo, 'wallet1-borrow-save', async () => {
    await page1.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await assertPositionTotals(page1, '1', '10');

  await stepSnapshot(page1, testInfo, 'wallet1-repay', async () => {
    await page1.getByRole('button', { name: 'Portfolio' }).click();
    await runSecureAction(page1, 'Repay', '5');
  });
  await seedPrivacyNotes(page1, wallet1Address as string, [
    {
      version: 2,
      commitment: '99'.repeat(32),
      nullifier: 'aa'.repeat(32),
      blindingFactor: 'bb'.repeat(32),
      ownerPubkey: 'cc'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(1_000_000_000),
      borrowAmount: String(5_000_000),
      noteIndex: 2,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page1, testInfo, 'wallet1-repay-save', async () => {
    await page1.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await assertPositionTotals(page1, '1', '5');

  const vaultExport = await readClipboard(page1);
  await stepSnapshot(page1, testInfo, 'wallet1-export', async () => {
    expect(vaultExport).toBeTruthy();
  });
  const wallet1Access = await page1.evaluate((noteString) => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('veillend.note_access:'));
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.noteString === noteString) return raw;
      } catch {
        continue;
      }
    }
    return null;
  }, vaultExport);
  expect(wallet1Access).toBeTruthy();

  const page2 = await browser.newPage();
  await initE2ePage(page2, Array.from(wallet2Secret), WALLET_2_PUBLIC_KEY);
  await stepSnapshot(page2, testInfo, 'wallet2-open', async () => {
    await page2.goto('/?e2e=1');
    await waitForTestWallet(page2);
  });

  await page2.evaluate(({ payload }) => {
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      const noteHash = parsed.noteHash;
      if (noteHash) {
        localStorage.setItem(`veillend.note_access:${noteHash}`, payload);
      }
    } catch {
      return;
    }
  }, { payload: wallet1Access });

  await stepSnapshot(page2, testInfo, 'wallet2-import', async () => {
    await page2.getByRole('button', { name: 'Portfolio' }).click();
  await page2.getByPlaceholder('Paste note string...').fill(vaultExport);
    await page2.getByRole('button', { name: 'Unlock Vault' }).click();
    await expect(page2.getByText('VAULT UNLOCKED')).toBeVisible();
  });
  await assertPositionTotals(page2, '1', '5');

  const wallet2Address = await getStoredWalletAddress(page2);
  expect(wallet2Address).toEqual(WALLET_2_PUBLIC_KEY);

  await stepSnapshot(page2, testInfo, 'wallet2-supply', async () => {
    await page2.getByRole('button', { name: 'Markets' }).click();
    await runSecureAction(page2, 'Supply', '1');
  });
  await seedPrivacyNotes(page2, wallet2Address as string, [
    {
      version: 2,
      commitment: 'dd'.repeat(32),
      nullifier: 'ee'.repeat(32),
      blindingFactor: 'ff'.repeat(32),
      ownerPubkey: '00'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(2_000_000_000),
      borrowAmount: String(5_000_000),
      noteIndex: 3,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page2, testInfo, 'wallet2-supply-save', async () => {
    await page2.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await assertPositionTotals(page2, '2', '5');

  await stepSnapshot(page2, testInfo, 'wallet2-borrow', async () => {
    await page2.getByRole('button', { name: 'Markets' }).click();
    await runSecureAction(page2, 'Borrow', '5');
  });
  await seedPrivacyNotes(page2, wallet2Address as string, [
    {
      version: 2,
      commitment: 'ab'.repeat(32),
      nullifier: 'bc'.repeat(32),
      blindingFactor: 'cd'.repeat(32),
      ownerPubkey: 'de'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(2_000_000_000),
      borrowAmount: String(10_000_000),
      noteIndex: 4,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page2, testInfo, 'wallet2-borrow-save', async () => {
    await page2.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await assertPositionTotals(page2, '2', '10');

  const wallet2Export = await readClipboard(page2);
  await stepSnapshot(page2, testInfo, 'wallet2-export', async () => {
    expect(wallet2Export).toBeTruthy();
  });
  const wallet2Access = await page2.evaluate((noteString) => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('veillend.note_access:'));
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.noteString === noteString) return raw;
      } catch {
        continue;
      }
    }
    return null;
  }, wallet2Export);
  expect(wallet2Access).toBeTruthy();

  const page1b = await browser.newPage();
  await initE2ePage(page1b, WALLET_1_SECRET ? Array.from(WALLET_1_SECRET) : undefined, WALLET_1_PUBLIC_KEY, undefined, undefined, true);
  await stepSnapshot(page1b, testInfo, 'wallet1b-open', async () => {
    await page1b.goto('/?e2e=1');
    await waitForTestWallet(page1b);
  });
  await page1b.evaluate(({ payload }) => {
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      const noteHash = parsed.noteHash;
      if (noteHash) {
        localStorage.setItem(`veillend.note_access:${noteHash}`, payload);
      }
    } catch {
      return;
    }
  }, { payload: wallet2Access });
  await stepSnapshot(page1b, testInfo, 'wallet1b-import', async () => {
    await page1b.getByRole('button', { name: 'Portfolio' }).click();
  await page1b.getByPlaceholder('Paste note string...').fill(wallet2Export);
    await page1b.getByRole('button', { name: 'Unlock Vault' }).click();
    await expect(page1b.getByText('VAULT UNLOCKED')).toBeVisible();
  });
  await assertPositionTotals(page1b, '2', '10');

  await stepSnapshot(page1b, testInfo, 'wallet1b-repay', async () => {
    await page1b.getByRole('button', { name: 'Portfolio' }).click();
    await runSecureAction(page1b, 'Repay', '3');
  });
  await seedPrivacyNotes(page1b, WALLET_1_PUBLIC_KEY as string, [
    {
      version: 2,
      commitment: 'ef'.repeat(32),
      nullifier: 'f0'.repeat(32),
      blindingFactor: '01'.repeat(32),
      ownerPubkey: '12'.repeat(32),
      vaultAddress: 'vault-1',
      depositAmount: String(2_000_000_000),
      borrowAmount: String(7_000_000),
      noteIndex: 5,
      createdAt: Date.now(),
      spent: false,
    },
  ]);
  await stepSnapshot(page1b, testInfo, 'wallet1b-repay-save', async () => {
    await page1b.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });
  await assertPositionTotals(page1b, '2', '7');
});
