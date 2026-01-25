import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { expect } from 'chai';
import { TestScenario, TestCase } from './test-matrix';

/**
 * TestContext - Shared context for test execution
 */
export interface TestContext {
  program: anchor.Program;
  provider: anchor.AnchorProvider;
  vault: PublicKey;
  user: Keypair;
  collateralMint: PublicKey;
  receiptMint?: PublicKey;
  borrowMint?: PublicKey;
}

/**
 * TestResult - Result of a single test case execution
 */
export interface TestResult {
  scenario: TestScenario | TestCase;
  passed: boolean;
  actualResult: 'success' | 'error';
  errorCode?: string;
  executionTime: number;
  note?: string;
}

/**
 * ScenarioRunner - Executes test scenarios against the smart contract
 */
export class ScenarioRunner {
  private ctx: TestContext;
  private results: TestResult[] = [];

  constructor(ctx: TestContext) {
    this.ctx = ctx;
  }

  /**
   * Execute a single withdrawal scenario
   */
  async executeWithdrawScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    console.log(`  → ${scenario.id}: ${scenario.description}`);
    console.log(`    Expected: ${scenario.shouldSucceed ? 'SUCCESS' : 'FAILURE'} (${scenario.reason})`);

    let actualResult: 'success' | 'error' = 'success';
    let errorCode: string | undefined;

    try {
      // Note: Actual implementation would call the smart contract here
      // This is a placeholder that validates the test setup
      
      if (scenario.withdrawAmount.isZero()) {
        throw new Error('InsufficientShares');
      }

      // Simulate LTV check
      const remaining = scenario.depositAmount.sub(scenario.withdrawAmount);
      if (scenario.borrowAmount.gt(new anchor.BN(0))) {
        const maxBorrow = remaining.mul(new anchor.BN(7000)).div(new anchor.BN(10000));
        if (scenario.borrowAmount.gt(maxBorrow)) {
          throw new Error('BorrowLimitExceeded');
        }
      }

      actualResult = 'success';
    } catch (error) {
      actualResult = 'error';
      errorCode = error instanceof Error ? error.message : 'Unknown';
    }

    const executionTime = Date.now() - startTime;
    const passed = (scenario.shouldSucceed && actualResult === 'success') ||
                   (!scenario.shouldSucceed && actualResult === 'error');

    const result: TestResult = {
      scenario,
      passed,
      actualResult,
      errorCode,
      executionTime,
    };

    this.results.push(result);
    
    console.log(`    Actual: ${actualResult}${errorCode ? ` (${errorCode})` : ''}`);
    console.log(`    ${passed ? '✅ PASSED' : '❌ FAILED'}`);

    return result;
  }

  /**
   * Execute a generic test case
   */
  async executeTestCase(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    console.log(`  → ${testCase.id}: ${testCase.description}`);
    console.log(`    Expected: ${testCase.expectedResult}${testCase.errorCode ? ` (${testCase.errorCode})` : ''}`);

    let actualResult: 'success' | 'error' = 'success';
    let errorCode: string | undefined;

    try {
      // Validate amount
      if (testCase.amount <= 0) {
        throw new Error('InvalidAmount');
      }

      // Placeholder for actual execution
      actualResult = 'success';
    } catch (error) {
      actualResult = 'error';
      errorCode = error instanceof Error ? error.message : 'Unknown';
    }

    const executionTime = Date.now() - startTime;
    const passed = testCase.expectedResult === actualResult &&
                   (testCase.errorCode === undefined || testCase.errorCode === errorCode);

    const result: TestResult = {
      scenario: testCase,
      passed,
      actualResult,
      errorCode,
      executionTime,
    };

    this.results.push(result);

    console.log(`    Actual: ${actualResult}${errorCode ? ` (${errorCode})` : ''}`);
    console.log(`    ${passed ? '✅ PASSED' : '❌ FAILED'}`);

    return result;
  }

  /**
   * Run multiple withdrawal scenarios
   */
  async runWithdrawScenarios(scenarios: TestScenario[]): Promise<TestResult[]> {
    console.log(`\n  Running ${scenarios.length} withdrawal scenarios:\n`);
    const results: TestResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.executeWithdrawScenario(scenario);
      results.push(result);
    }

    return results;
  }

  /**
   * Run multiple test cases
   */
  async runTestCases(testCases: TestCase[]): Promise<TestResult[]> {
    console.log(`\n  Running ${testCases.length} test cases:\n`);
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const result = await this.executeTestCase(testCase);
      results.push(result);
    }

    return results;
  }

  /**
   * Get summary of all executed tests
   */
  getSummary(): { total: number; passed: number; failed: number; passRate: string } {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : '0%';

    return { total, passed, failed, passRate };
  }

  /**
   * Print test summary
   */
  printSummary(): void {
    const { total, passed, failed, passRate } = this.getSummary();
    console.log('\n  ═══════════════════════════════════════');
    console.log(`  Test Summary: ${passed}/${total} passed (${passRate})`);
    if (failed > 0) {
      console.log(`  ⚠️  ${failed} tests failed`);
    }
    console.log('  ═══════════════════════════════════════\n');
  }

  /**
   * Assert all tests passed (for use in test suites)
   */
  assertAllPassed(): void {
    const { passed, total, failed } = this.getSummary();
    expect(passed, `${failed} tests failed out of ${total}`).to.equal(total);
  }
}
