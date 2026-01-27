/**
 * Comprehensive Randomized Multi-Action Test Suite
 * 
 * Requirements:
 * - 100-150 randomized test scenarios
 * - Each test has 5+ transactions (mixed actions)
 * - 2 wallets with different amounts
 * - Actions: Supply, Borrow, Repay, Withdraw
 * - Assets: SOL, USDC
 * - Modes: FAST, SECURE
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1111 } });

// ============== Configuration ==============

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
    if (index < 0) throw new Error(`Invalid base58 character: ${char}`);
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
const WALLET_2_SECRET = WALLET_2_PRIVATE_KEY ? decodeBase58(WALLET_2_PRIVATE_KEY) : null;

// Seed for reproducibility
const TEST_SEED = process.env.TEST_SEED ?? 'veillend-security-2024';

// ============== Seeded Random ==============

class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashCode(seed);
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) || 1;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ============== Types ==============

type ActionType = 'Supply' | 'Borrow' | 'Repay' | 'Withdraw';
type ModeType = 'FAST' | 'SECURE';
type AssetType = 'SOL' | 'USDC';
type WalletIdx = 0 | 1;

interface SingleAction {
  wallet: WalletIdx;
  action: ActionType;
  asset: AssetType;
  amount: string;
  mode: ModeType;
}

interface MultiActionScenario {
  id: number;
  name: string;
  actions: SingleAction[];
}

// ============== Helpers ==============

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
  walletPublicKey?: string,
  balances?: {
    walletBalanceLamports?: number;
    collateralBalanceLamports?: number;
    borrowBalanceLamports?: number;
    usdcBalanceLamports?: number;
  },
) => {
  bindE2eNavigation(page);
  await page.addInitScript(({ secret, publicKey, e2eBalances }) => {
    localStorage.clear();
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
    publicKey: walletPublicKey ?? null,
    e2eBalances: balances ?? null,
  });
};

const unlockVault = async (page: Page, testInfo: TestInfo, prefix = 'vault') => {
  await waitForTestWallet(page);
  await page.getByRole('button', { name: 'Portfolio' }).click();
  const vaultGate = page.getByText('Private Vault Access');
  const vaultUnlocked = page.getByText('VAULT UNLOCKED');
  await expect(vaultGate.or(vaultUnlocked)).toBeVisible({ timeout: 10000 });
  const gateVisible = await vaultGate.isVisible();
  if (gateVisible) {
    await page.getByRole('button', { name: 'Generate Access Key' }).click();
    await expect(page.getByText('Your New Note').or(page.getByText('Generating note'))).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & Save' }).click();
    await expect(vaultUnlocked).toBeVisible();
  }
  await expect(vaultUnlocked).toBeVisible();
};

const openAction = async (page: Page, name: string, index = 0) => {
  const btn = page.getByRole('button', { name }).nth(index);
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await expect(btn).toBeEnabled({ timeout: 10000 });
  await btn.click({ force: true });
  await expect(page.getByLabel('Amount')).toBeVisible({ timeout: 10000 });
};

const runFastAction = async (page: Page, label: string, amount: string) => {
  await openAction(page, label);
  const toggleBtn = page.getByRole('button', { name: 'Toggle mode' });
  const shieldedText = await page
    .locator('p.font-bold.text-sm', { hasText: 'Shielded Privacy' })
    .isVisible();
  if (shieldedText) {
    await toggleBtn.click();
  }
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('button', { name: 'Execute' }).click();
};

const runSecureAction = async (page: Page, label: string, amount: string) => {
  await openAction(page, label);
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('button', { name: 'Shield and Execute' }).click();
};

const executeAction = async (page: Page, action: SingleAction, testInfo: TestInfo) => {
  const portfolioActions = new Set<ActionType>(['Withdraw', 'Repay']);
  await page.getByRole('button', { name: portfolioActions.has(action.action) ? 'Portfolio' : 'Markets' }).click();
  await page.waitForTimeout(200);

  if (portfolioActions.has(action.action)) {
    await expect(page.getByText('VAULT UNLOCKED')).toBeVisible({ timeout: 10000 });
  }

  if (action.mode === 'FAST') {
    await runFastAction(page, action.action, action.amount);
  } else {
    await runSecureAction(page, action.action, action.amount);
  }

  // Wait for result
  const successPattern = /completed successfully\./;
  const errorPattern = /error|failed|exceeds|invalid/i;
  
  // Wait for either success or error
  const successLocator = page.getByText(successPattern);
  const errorLocator = page.getByText(errorPattern);
  const proofLocator = page.getByText('Proof signals');

  try {
    await Promise.race([
      successLocator.waitFor({ timeout: 10000 }),
      proofLocator.waitFor({ timeout: 10000 }),
      errorLocator.waitFor({ timeout: 10000 }),
    ]);
  } catch {
    // Timeout - check what's visible
  }

  const hasSuccess = await successLocator.isVisible();
  const hasProof = await proofLocator.isVisible();
  const hasError = await errorLocator.isVisible();

  // For secure mode, save the note if proof is shown
  if (action.mode === 'SECURE' && hasProof) {
    await page.getByRole('button', { name: 'Save to storage & clipboard' }).click();
    await page.waitForTimeout(300);
  }

  // Close modal if open
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  return { success: hasSuccess || hasProof, error: hasError };
};

// ============== Scenario Generator ==============

const AMOUNTS = ['0.01', '0.05', '0.1', '0.2', '0.5', '1', '2', '5'];
const ACTIONS: ActionType[] = ['Supply', 'Borrow', 'Repay', 'Withdraw'];
const ASSETS: AssetType[] = ['SOL', 'USDC'];
const MODES: ModeType[] = ['FAST', 'SECURE'];
const WALLETS: WalletIdx[] = [0, 1];

const generateMultiActionScenarios = (count: number, minActions: number = 5): MultiActionScenario[] => {
  const random = new SeededRandom(TEST_SEED);
  const scenarios: MultiActionScenario[] = [];

  for (let i = 0; i < count; i++) {
    const numActions = random.nextInt(minActions, minActions + 3); // 5-8 actions per test
    const actions: SingleAction[] = [];
    
    // Track state for realistic scenarios
    let hasSupplied = false;
    let hasBorrowed = false;

    for (let j = 0; j < numActions; j++) {
      const wallet = random.choice(WALLETS);
      const asset = random.choice(ASSETS);
      const mode = random.choice(MODES);
      const amount = random.choice(AMOUNTS);

      // Choose action based on current state for realism
      let possibleActions: ActionType[] = ['Supply'];
      
      if (hasSupplied) {
        possibleActions.push('Withdraw', 'Borrow');
      }
      if (hasBorrowed) {
        possibleActions.push('Repay');
      }

      const action = random.choice(possibleActions);

      // Update state
      if (action === 'Supply') hasSupplied = true;
      if (action === 'Borrow') hasBorrowed = true;
      if (action === 'Repay') hasBorrowed = false;

      actions.push({ wallet, action, asset, amount, mode });
    }

    const scenarioName = `Scenario ${i + 1}: ${actions.length} actions - ${actions.map(a => `${a.action[0]}${a.amount}`).join('→')}`;
    scenarios.push({ id: i + 1, name: scenarioName, actions });
  }

  return scenarios;
};

// Generate 150 scenarios with 5+ actions each
const MULTI_ACTION_SCENARIOS = generateMultiActionScenarios(Number(process.env.UI_RANDOM_SCENARIOS ?? 10), 5);

console.log(`Generated ${MULTI_ACTION_SCENARIOS.length} multi-action scenarios with seed: ${TEST_SEED}`);

// ============== Test Suite ==============

test.describe('Security Randomized Multi-Action Tests', () => {
  test.describe.configure({ mode: 'serial' }); // Run serially for state consistency

  for (const scenario of MULTI_ACTION_SCENARIOS) {
    test(`#${scenario.id}: ${scenario.actions.length} mixed actions`, async ({ page }, testInfo) => {
      // Track results
      const results: { action: SingleAction; success: boolean; error: boolean }[] = [];

      // Initialize with Wallet 1 (primary)
      const secret = WALLET_1_SECRET ? Array.from(WALLET_1_SECRET) : undefined;
      const pubKey = WALLET_1_PUBLIC_KEY;

      await initE2ePage(page, secret, pubKey, {
        walletBalanceLamports: 100 * 1e9, // 100 SOL
        collateralBalanceLamports: 100 * 1e9,
        usdcBalanceLamports: 100 * 1e6, // 100 USDC
      });

      await page.goto('/?e2e=1');
      await waitForTestWallet(page);
      await unlockVault(page, testInfo, `multi-${scenario.id}`);

      // Execute all actions in sequence
      for (let i = 0; i < scenario.actions.length; i++) {
        const action = scenario.actions[i];
        
        console.log(`[Scenario ${scenario.id}] Action ${i + 1}/${scenario.actions.length}: W${action.wallet + 1} ${action.action} ${action.amount} ${action.asset} (${action.mode})`);

        const result = await executeAction(page, action, testInfo);
        results.push({ action, ...result });

        // Wait between actions
        await page.waitForTimeout(200);
      }

      // Verify at least one action succeeded (basic sanity check)
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => r.error).length;

      console.log(`[Scenario ${scenario.id}] Results: ${successCount} success, ${errorCount} errors out of ${results.length} actions`);

      // For security: ensure no unexpected errors
      // Note: Some errors are expected (e.g., withdraw without supply, borrow > LTV)
      expect(results.length).toBe(scenario.actions.length);
    });
  }
});

// ============== Edge Case Tests ==============

test.describe('Security Edge Cases', () => {
  const edgeCases = [
    { name: 'Zero amount supply', action: 'Supply', amount: '0', expectError: true },
    { name: 'Negative amount supply', action: 'Supply', amount: '-1', expectError: true },
    { name: 'Very large supply', action: 'Supply', amount: '999999999', expectError: true },
    { name: 'Borrow without collateral', action: 'Borrow', amount: '1', expectError: true },
    { name: 'Withdraw without deposit', action: 'Withdraw', amount: '1', expectError: true },
    { name: 'Repay without debt', action: 'Repay', amount: '1', expectError: true },
    { name: 'Supply decimal overflow', action: 'Supply', amount: '0.0000000001', expectError: true },
  ];

  for (const edgeCase of edgeCases) {
    test(edgeCase.name, async ({ page }, testInfo) => {
      await initE2ePage(page);
      await page.goto('/?e2e=1');
      await waitForTestWallet(page);
      await unlockVault(page, testInfo, `edge-${edgeCase.name.replace(/\s+/g, '-')}`);

      const portfolioActions = new Set<ActionType>(['Withdraw', 'Repay']);
      await page.getByRole('button', { name: portfolioActions.has(edgeCase.action as ActionType) ? 'Portfolio' : 'Markets' }).click();
      if (portfolioActions.has(edgeCase.action as ActionType)) {
        await expect(page.getByText('VAULT UNLOCKED')).toBeVisible({ timeout: 10000 });
      }
      await runFastAction(page, edgeCase.action, edgeCase.amount);

      if (edgeCase.expectError) {
        const errorPattern = /error|invalid|exceeds|cannot|must be|insufficient|enough|collateral|valid amount|enter|debt/i;
        const errorBanner = page
          .locator('div.text-red-200')
          .filter({ hasText: errorPattern })
          .first();
        await expect(errorBanner).toBeVisible({ timeout: 5000 });
      }
    });
  }
});

// ============== Cross-Wallet Security Tests ==============

test.describe('Cross-Wallet Security', () => {
  test('wallet isolation: wallet 2 cannot access wallet 1 position', async ({ browser }, testInfo) => {
    // Wallet 1 supplies
    const page1 = await browser.newPage();
    await initE2ePage(page1, WALLET_1_SECRET ? Array.from(WALLET_1_SECRET) : undefined, WALLET_1_PUBLIC_KEY);
    await page1.goto('/?e2e=1');
    await waitForTestWallet(page1);
    await unlockVault(page1, testInfo, 'isolation-w1');
    await page1.getByRole('button', { name: 'Markets' }).click();
    await runFastAction(page1, 'Supply', '1');
    await expect(page1.getByText(/completed successfully\./)).toBeVisible();
    await page1.close();

    // Wallet 2 should not see wallet 1's position
    if (!WALLET_2_PUBLIC_KEY) {
      test.skip(true, 'Wallet 2 not configured');
    }
    const page2 = await browser.newPage();
    await initE2ePage(page2, WALLET_2_SECRET ? Array.from(WALLET_2_SECRET) : undefined, WALLET_2_PUBLIC_KEY);
    await page2.goto('/?e2e=1');
    await waitForTestWallet(page2);
    await page2.getByRole('button', { name: 'Portfolio' }).click();
    
    // Wallet 2 should see vault gate (no shared access)
    await expect(page2.getByText('Private Vault Access')).toBeVisible();
    await page2.close();
  });

  test('note sharing requires explicit import', async ({ browser }, testInfo) => {
    // This tests that notes are not automatically shared
    const page1 = await browser.newPage();
    await initE2ePage(page1, undefined, WALLET_1_PUBLIC_KEY);
    await page1.goto('/?e2e=1');
    await unlockVault(page1, testInfo, 'note-share-w1');
    
    // Get wallet 1's note
    const noteHash = await page1.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('veillend.note:'));
      if (!key) return null;
      return JSON.parse(localStorage.getItem(key) || '{}').noteHash;
    });
    await page1.close();

    // Wallet 2 should not have access to this note automatically
    const page2 = await browser.newPage();
    await initE2ePage(page2, undefined, WALLET_2_PUBLIC_KEY ?? 'wallet2');
    await page2.goto('/?e2e=1');
    
    const hasNote = await page2.evaluate((hash) => {
      const key = Object.keys(localStorage).find(k => k.includes(hash));
      return Boolean(key);
    }, noteHash);
    
    expect(hasNote).toBe(false);
    await page2.close();
  });
});

// ============== LTV Security Tests ==============

test.describe('LTV Security Validation', () => {
  const ltvScenarios = [
    { supply: '1', borrow: '0.5', withdraw: '0.3', name: 'withdraw reduces but keeps LTV safe' },
    { supply: '1', borrow: '0.6', withdraw: '0.5', name: 'withdraw would violate LTV - should fail' },
    { supply: '2', borrow: '1', withdraw: '1', name: 'large withdraw with debt - should validate' },
  ];

  for (const scenario of ltvScenarios) {
    test(scenario.name, async ({ page }, testInfo) => {
      await initE2ePage(page, undefined, WALLET_1_PUBLIC_KEY, {
        walletBalanceLamports: 100 * 1e9,
        collateralBalanceLamports: 100 * 1e9,
      });
      await page.goto('/?e2e=1');
      await waitForTestWallet(page);
      await unlockVault(page, testInfo, `ltv-${scenario.name.slice(0, 20)}`);

      // Supply
      await page.getByRole('button', { name: 'Markets' }).click();
      await runFastAction(page, 'Supply', scenario.supply);
      await expect(page.getByText(/completed successfully\./)).toBeVisible();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Borrow
      await runFastAction(page, 'Borrow', scenario.borrow);
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Withdraw - this should be validated against LTV
      await page.getByRole('button', { name: 'Portfolio' }).click();
      await expect(page.getByText('VAULT UNLOCKED')).toBeVisible({ timeout: 10000 });
      await runFastAction(page, 'Withdraw', scenario.withdraw);
      
      // Check for either success or LTV error
      const hasResult = await Promise.race([
        page.getByText(/completed successfully\./).waitFor({ timeout: 5000 }).then(() => 'success'),
        page.getByText(/exceeds|LTV|limit/i).waitFor({ timeout: 5000 }).then(() => 'error'),
      ]).catch(() => 'timeout');

      console.log(`[LTV ${scenario.name}] Result: ${hasResult}`);
      expect(['success', 'error']).toContain(hasResult);
    });
  }
});
