import fs from 'fs';
import path from 'path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1111 } });

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

const WALLET_1_PUBLIC_KEY = readEnv('E2E_WALLET_1_PUBLIC_KEY') ?? readEnv('PUBLIC_KEY') ?? '11111111111111111111111111111111';

const waitForTestWallet = async (page: Page) => {
  await page.waitForFunction(
    () => Boolean((window as any).__VEILLEND_TEST_WALLET__),
    { timeout: 30000 }
  );
};

const bindE2eNavigation = (page: Page) => {
  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const response = await originalGoto(url, options);
    if (typeof url === 'string' && url.includes('e2e=1')) {
      await waitForTestWallet(page);
      await page.waitForSelector('nav', { state: 'visible' });
    }
    return response;
  };
};

const initE2ePage = async (
  page: Page,
  walletSecret?: number[],
  walletPublicKey?: string | null,
  balances?: {
    walletBalanceLamports?: number;
    collateralBalanceLamports?: number;
    borrowBalanceLamports?: number;
    usdcBalanceLamports?: number;
  },
) => {
  bindE2eNavigation(page);
  await page.addInitScript(({ secret, publicKey, e2eBalances }) => {
    localStorage.setItem('walletName', 'TestWallet');
    (window as any).__VEILLEND_TEST_CLIPBOARD__ = '';
    if (secret) (window as any).__VEILLEND_E2E_WALLET_SECRET__ = secret;
    (window as any).__VEILLEND_E2E_WALLET_PUBLIC_KEY__ = publicKey ?? null;
    if (e2eBalances) (window as any).__VEILLEND_E2E_BALANCES__ = e2eBalances;
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
    secret: walletSecret ?? null,
    publicKey: walletPublicKey,
    e2eBalances: balances ?? null,
  });
};

const unlockVault = async (page: Page) => {
  await waitForTestWallet(page);
  await page.getByRole('button', { name: 'Portfolio' }).click();
  const vaultGate = page.getByText('Private Vault Access');
  const vaultUnlocked = page.getByText('VAULT UNLOCKED');
  await expect(vaultGate.or(vaultUnlocked)).toBeVisible({ timeout: 10000 });
  const gateVisible = await vaultGate.isVisible();
  if (gateVisible) {
    await page.getByRole('button', { name: 'Generate Access Key' }).click();
    // Wait for the note generation to complete and show the confirmation screen
    await expect(page.getByRole('button', { name: 'Copy & Save' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Copy & Save' }).click();
    await expect(vaultUnlocked).toBeVisible();
  }
  await expect(vaultUnlocked).toBeVisible();
};

const openAction = async (page: Page, name: string, index = 0) => {
  const btn = page.getByRole('button', { name }).nth(index);
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await btn.click({ force: true });
  await expect(page.getByLabel('Amount')).toBeVisible({ timeout: 10000 });
};

const runSecureAction = async (page: Page, label: string, amount: string) => {
  await openAction(page, label);
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('button', { name: 'Shield and Execute' }).click();
};

test.describe('Bug Fixes Verification', () => {
  test('Fix 1: Shielded Supply succeeds on first try (Merkle Init)', async ({ page }) => {
    await initE2ePage(page, undefined, WALLET_1_PUBLIC_KEY);
    await page.goto('/?e2e=1');
    
    await unlockVault(page);

    await page.getByRole('button', { name: 'Markets' }).click();

    await runSecureAction(page, 'Supply', '0.1');

    await expect(page.getByText(/completed successfully\./)).toBeVisible({ timeout: 15000 });
    
    await expect(page.getByText('Proof signals')).toBeVisible();
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
  });

  test('Fix 2: Notes are copyable after logout', async ({ page }) => {
    const mockNote = {
      version: 1,
      walletAddress: WALLET_1_PUBLIC_KEY,
      noteHash: 'mock-hash-123',
      noteString: 'veil-note-v1:mock-note-string-content',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await page.addInitScript((note) => {
      localStorage.setItem(`veillend.note:${note.walletAddress}`, JSON.stringify(note));
    }, mockNote);

    await initE2ePage(page, undefined, null);
    await page.goto('/?e2e=1');

    await page.getByRole('button', { name: 'Portfolio' }).click();

    await expect(page.getByText('Saved Notes (Local Storage)')).toBeVisible();

    await expect(page.getByText(WALLET_1_PUBLIC_KEY.slice(0, 6))).toBeVisible();

    await page.getByRole('button', { name: 'Copy Note' }).click();
    
    const clipboardContent = await page.evaluate(() => (window as any).__VEILLEND_TEST_CLIPBOARD__);
    expect(clipboardContent).toBe(mockNote.noteString);
  });

  test('Fix 3: Demo secure action keeps note access key stable', async ({ page }) => {
    await initE2ePage(page, undefined, WALLET_1_PUBLIC_KEY);
    await page.goto('/demo?e2e=1');

    await unlockVault(page);

    const noteBefore = await page.evaluate((wallet) => {
      const raw = localStorage.getItem(`veillend.note:${wallet}`);
      return raw ? JSON.parse(raw) : null;
    }, WALLET_1_PUBLIC_KEY);
    expect(noteBefore?.noteString).toBeTruthy();

    await page.getByRole('button', { name: 'Markets' }).click();
    await runSecureAction(page, 'Supply', '0.1');

    await expect(page.getByText(/completed successfully\./)).toBeVisible({ timeout: 15000 });

    const noteAfter = await page.evaluate((wallet) => {
      const raw = localStorage.getItem(`veillend.note:${wallet}`);
      return raw ? JSON.parse(raw) : null;
    }, WALLET_1_PUBLIC_KEY);

    expect(noteAfter?.noteHash).toBe(noteBefore?.noteHash);
    expect(noteAfter?.noteString).toBe(noteBefore?.noteString);
  });
});
