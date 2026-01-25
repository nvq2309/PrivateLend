import { SeededRandom } from './seed';
import BN from 'bn.js';

/**
 * TestScenario - Represents a single test case for withdrawal validation
 */
export interface TestScenario {
  id: string;
  description: string;
  depositAmount: BN;
  borrowAmount: BN;
  withdrawAmount: BN;
  shouldSucceed: boolean;
  reason: string;
}

/**
 * WalletId - Identifiers for test wallets
 */
export type WalletId = 'wallet_1' | 'wallet_2';

/**
 * Action - Available DeFi actions in VeilLend
 */
export type Action = 'supply' | 'borrow' | 'withdraw' | 'repay';

/**
 * Mode - Transaction modes
 */
export type Mode = 'fast' | 'secure';

/**
 * Symbol - Supported token symbols
 */
export type Symbol = 'SOL' | 'USDC';

/**
 * TestCase - Generic test case for any action
 */
export interface TestCase {
  id: string;
  wallet: WalletId;
  action: Action;
  mode: Mode;
  amount: number;
  symbol: Symbol;
  expectedResult: 'success' | 'error';
  errorCode?: string;
  description: string;
}

export const TEST_AMOUNTS = [0.1, 0.2, 1, 2, 3, 5, 10, 100, 0, -1] as const;
export const WALLETS: WalletId[] = ['wallet_1', 'wallet_2'];
export const ACTIONS: Action[] = ['supply', 'borrow', 'withdraw', 'repay'];
export const MODES: Mode[] = ['fast', 'secure'];
export const SYMBOLS: Symbol[] = ['SOL', 'USDC'];

/**
 * Constants for LTV calculations
 */
export const BPS_DENOMINATOR = 10000;
export const DEFAULT_LTV_BPS = 7000; // 70%

/**
 * Determine expected result based on test parameters
 */
export const determineExpectedResult = (
  action: Action,
  amount: number,
  _mode: Mode,
): { result: 'success' | 'error'; errorCode?: string } => {
  if (amount <= 0) return { result: 'error', errorCode: 'InvalidAmount' };
  if (amount > 50) return { result: 'error', errorCode: 'ExceedsBalance' };
  return { result: 'success' };
};

/**
 * TestMatrixGenerator - Generates randomized test cases for comprehensive coverage
 */
export class TestMatrixGenerator {
  private rng: SeededRandom;

  constructor(seed: string) {
    this.rng = new SeededRandom(seed);
  }

  /**
   * Generate randomized test cases for any action
   */
  generateTestCases(count: number): TestCase[] {
    const cases: TestCase[] = [];

    for (let i = 0; i < count; i++) {
      const wallet = this.rng.choice(WALLETS);
      const action = this.rng.choice(ACTIONS);
      const mode = this.rng.choice(MODES);
      const amount = this.rng.choice([...TEST_AMOUNTS]);
      const symbol = this.rng.choice(SYMBOLS);
      const { result, errorCode } = determineExpectedResult(action, amount, mode);

      cases.push({
        id: `tc-${i.toString().padStart(3, '0')}`,
        wallet,
        action,
        mode,
        amount,
        symbol,
        expectedResult: result,
        errorCode,
        description: `${wallet} ${action} ${amount} ${symbol} (${mode})`,
      });
    }

    return cases;
  }

  /**
   * Generate withdrawal-specific scenarios with LTV validation
   */
  generateWithdrawScenarios(count: number, ltvBps: number = DEFAULT_LTV_BPS): TestScenario[] {
    const scenarios: TestScenario[] = [];

    for (let i = 0; i < count; i++) {
      // Random deposit between 1 and 100 SOL (in lamports)
      const depositLamports = this.rng.nextBigInt(1_000_000_000n, 100_000_000_000n);
      
      // Calculate max borrow at given LTV
      const maxBorrow = (depositLamports * BigInt(ltvBps)) / BigInt(BPS_DENOMINATOR);
      
      // Random borrow percentage (0-80% of max)
      const borrowPct = this.rng.nextInt(0, 80);
      const borrowLamports = (maxBorrow * BigInt(borrowPct)) / 100n;
      
      // Random withdraw percentage (10-90% of deposit)
      const withdrawPct = this.rng.nextInt(10, 90);
      const withdrawLamports = (depositLamports * BigInt(withdrawPct)) / 100n;

      // Calculate if withdrawal would maintain healthy LTV
      const remainingCollateral = depositLamports - withdrawLamports;
      const maxBorrowAfterWithdraw = (remainingCollateral * BigInt(ltvBps)) / BigInt(BPS_DENOMINATOR);
      const shouldSucceed = borrowLamports <= maxBorrowAfterWithdraw;

      const currentLtv = remainingCollateral > 0n 
        ? Number(borrowLamports * 10000n / remainingCollateral) / 100
        : 0;

      scenarios.push({
        id: `withdraw-ltv-${i.toString().padStart(3, '0')}`,
        description: `Deposit ${depositLamports}, Borrow ${borrowLamports}, Withdraw ${withdrawLamports}`,
        depositAmount: new BN(depositLamports.toString()),
        borrowAmount: new BN(borrowLamports.toString()),
        withdrawAmount: new BN(withdrawLamports.toString()),
        shouldSucceed,
        reason: shouldSucceed
          ? `LTV after withdraw: ${currentLtv.toFixed(2)}% (within ${ltvBps / 100}%)`
          : `LTV after withdraw: ${currentLtv.toFixed(2)}% (exceeds ${ltvBps / 100}%)`,
      });
    }

    return scenarios;
  }

  /**
   * Generate edge cases for thorough boundary testing
   */
  generateEdgeCases(ltvBps: number = DEFAULT_LTV_BPS): TestScenario[] {
    return [
      // Full withdraw with no debt
      {
        id: 'edge-no-borrow-full-withdraw',
        description: 'No debt, withdraw 100%',
        depositAmount: new BN(10_000_000_000),
        borrowAmount: new BN(0),
        withdrawAmount: new BN(10_000_000_000),
        shouldSucceed: true,
        reason: 'No debt allows full withdrawal',
      },
      // Max LTV, tiny withdraw should fail
      {
        id: 'edge-max-ltv-tiny-withdraw',
        description: 'Max LTV, withdraw 1 lamport',
        depositAmount: new BN(10_000_000_000),
        borrowAmount: new BN((10_000_000_000n * BigInt(ltvBps) / BigInt(BPS_DENOMINATOR)).toString()),
        withdrawAmount: new BN(1),
        shouldSucceed: false,
        reason: 'Even tiny withdrawal breaks max LTV',
      },
      // Half LTV, half withdraw - should work at 50% LTV
      {
        id: 'edge-half-ltv-safe-withdraw',
        description: '35% LTV, withdraw 50%',
        depositAmount: new BN(10_000_000_000),
        borrowAmount: new BN((10_000_000_000n * BigInt(ltvBps) / 2n / BigInt(BPS_DENOMINATOR)).toString()),
        withdrawAmount: new BN(5_000_000_000),
        shouldSucceed: false,
        reason: '35% borrow on 50% collateral = 70% LTV = exact boundary',
      },
      // Minimal amounts - tests overflow protection
      {
        id: 'edge-minimal-amounts',
        description: 'Minimal amounts',
        depositAmount: new BN(1000),
        borrowAmount: new BN(500),
        withdrawAmount: new BN(100),
        shouldSucceed: true,
        reason: 'Tests overflow protection with tiny values',
      },
      // Zero withdraw
      {
        id: 'edge-zero-withdraw',
        description: 'Zero withdrawal amount',
        depositAmount: new BN(10_000_000_000),
        borrowAmount: new BN(0),
        withdrawAmount: new BN(0),
        shouldSucceed: false,
        reason: 'Zero withdrawal should fail validation',
      },
    ];
  }

  /**
   * Generate specific edge case tests for cross-wallet and secure mode
   */
  generateCrossWalletTests(): TestCase[] {
    return [
      // LTV boundary tests
      {
        id: 'edge-ltv-001',
        wallet: 'wallet_1',
        action: 'withdraw',
        mode: 'fast',
        amount: 0.01,
        symbol: 'SOL',
        expectedResult: 'success',
        description: 'Withdraw small amount with active borrow',
      },
      {
        id: 'edge-ltv-002',
        wallet: 'wallet_1',
        action: 'withdraw',
        mode: 'fast',
        amount: 0.5,
        symbol: 'SOL',
        expectedResult: 'error',
        errorCode: 'BorrowLimitExceeded',
        description: 'Withdraw exceeds LTV',
      },
      // Zero amount tests
      {
        id: 'edge-zero-001',
        wallet: 'wallet_1',
        action: 'supply',
        mode: 'fast',
        amount: 0,
        symbol: 'SOL',
        expectedResult: 'error',
        errorCode: 'InvalidAmount',
        description: 'Supply zero',
      },
      // Negative amount tests
      {
        id: 'edge-neg-001',
        wallet: 'wallet_2',
        action: 'borrow',
        mode: 'secure',
        amount: -1,
        symbol: 'USDC',
        expectedResult: 'error',
        errorCode: 'InvalidAmount',
        description: 'Borrow negative',
      },
      // Secure mode tests
      {
        id: 'edge-note-001',
        wallet: 'wallet_1',
        action: 'supply',
        mode: 'secure',
        amount: 1,
        symbol: 'SOL',
        expectedResult: 'success',
        description: 'Wallet 1 secure supply with own note',
      },
      {
        id: 'edge-note-002',
        wallet: 'wallet_2',
        action: 'borrow',
        mode: 'secure',
        amount: 1,
        symbol: 'USDC',
        expectedResult: 'success',
        description: 'Wallet 2 secure borrow with own note',
      },
    ];
  }
}
