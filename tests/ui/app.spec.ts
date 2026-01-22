import { test, expect, type Page } from '@playwright/test';

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

const unlockVault = async (page: Page) => {
  await waitForTestWallet(page);
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Private Vault Access')).toBeVisible();
  await page.getByRole('button', { name: 'Generate Access Key' }).click();
  await expect(page.getByText('Your New Note')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm & Save' }).click();
  await expect(page.getByText('VAULT UNLOCKED')).toBeVisible();
};

const openAction = async (page: Page, name: string, index = 0) => {
  await page.getByRole('button', { name }).nth(index).click();
  await expect(page.getByLabel('Amount')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test('renders markets dashboard', async ({ page }) => {
  await page.goto('/?e2e=1');
  await expect(page.getByText('VeilLend Markets')).toBeVisible();
  await expect(page.getByText('Vault Collateral')).toBeVisible();
});

test('portfolio gate creates and stores an initial note', async ({ page }) => {
  await page.goto('/?e2e=1');
  await unlockVault(page);
  const note = await getStoredNote(page);
  expect(note?.noteHash).toBeTruthy();
  await page.getByRole('button', { name: 'Lock Vault' }).click();
  await expect(page.getByText('Private Vault Access')).toBeVisible();
});

test('secure supply creates proof and rotates note', async ({ page }) => {
  await page.goto('/?e2e=1');
  await unlockVault(page);
  const initialNote = await getStoredNote(page);

  await page.getByRole('button', { name: 'Markets' }).click();
  await openAction(page, 'Supply', 0);
  await page.getByLabel('Amount').fill('1');
  await page.getByRole('button', { name: 'Shield and Execute' }).click();

  await expect(page.getByText('Proof hash')).toBeVisible();
  await expect(page.getByText('New note')).toBeVisible();
  await page.getByRole('button', { name: 'Save to storage' }).click();

  const nextNote = await getStoredNote(page);
  expect(initialNote?.noteHash).toBeTruthy();
  expect(nextNote?.noteHash).toBeTruthy();
  expect(nextNote?.noteHash).not.toEqual(initialNote?.noteHash);
});

test('fast supply skips proof output', async ({ page }) => {
  await page.goto('/?e2e=1');
  await unlockVault(page);

  await page.getByRole('button', { name: 'Markets' }).click();
  await openAction(page, 'Supply', 0);
  await page.getByRole('button', { name: 'Toggle mode' }).click();
  await page.getByLabel('Amount').fill('1');
  await page.getByRole('button', { name: 'Execute' }).click();

  await expect(page.getByText(/completed successfully\./)).toBeVisible();
  await expect(page.getByText('Proof hash')).toHaveCount(0);
});

test('borrow/repay/withdraw parity for fast and secure', async ({ page }) => {
  await page.goto('/?e2e=1');
  await unlockVault(page);

  const runAction = async (label: string, mode: 'FAST' | 'SECURE') => {
    await openAction(page, label);
    if (mode === 'FAST') {
      await page.getByRole('button', { name: 'Toggle mode' }).click();
      await page.getByLabel('Amount').fill('1');
      await page.getByRole('button', { name: 'Execute' }).click();
      await expect(page.getByText(/completed successfully\./)).toBeVisible();
    } else {
      await page.getByLabel('Amount').fill('1');
      await page.getByRole('button', { name: 'Shield and Execute' }).click();
      await expect(page.getByText('Proof hash')).toBeVisible();
      await page.getByRole('button', { name: 'Save to storage' }).click();
    }
  };

  await page.getByRole('button', { name: 'Portfolio' }).click();

  for (const action of ['Borrow', 'Repay', 'Withdraw']) {
    await runAction(action, 'SECURE');
    await runAction(action, 'FAST');
  }
});
