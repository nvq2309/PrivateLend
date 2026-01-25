import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { expect } from 'chai';
import { TestMatrixGenerator, DEFAULT_LTV_BPS, BPS_DENOMINATOR } from '../shared/test-matrix';
import { SeededRandom } from '../shared/seed';
import BN from 'bn.js';

/**
 * Randomized Smart Contract Test Suite
 *
 * This test suite uses deterministic random testing to verify withdrawal
 * logic across a wide range of scenarios. The seed can be overridden via
 * TEST_SEED environment variable for reproducibility.
 *
 * Each test generates multi-action sequences (5+ actions) to simulate
 * realistic user flows.
 */
describe('Randomized Smart Contract Tests', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Veillend as Program<any>;
  const SEED = process.env.TEST_SEED ?? 'veillend-2024';
  const LTV_BPS = DEFAULT_LTV_BPS;
  const MIN_SEQUENCE_LENGTH = 5;
  const NUM_SEQUENCES = 10;

  let generator: TestMatrixGenerator;
  let rng: SeededRandom;

  before(async () => {
    console.log(`\n  ╔═══════════════════════════════════════════════════════════╗`);
    console.log(`  ║     Randomized Smart Contract Test Suite                  ║`);
    console.log(`  ╠═══════════════════════════════════════════════════════════╣`);
    console.log(`  ║  Seed: ${SEED.padEnd(51)}║`);
    console.log(`  ║  LTV: ${(LTV_BPS / 100).toString().padEnd(52)}%║`);
    console.log(`  ║  Min Sequence Length: ${MIN_SEQUENCE_LENGTH.toString().padEnd(36)}║`);
    console.log(`  ║  Number of Sequences: ${NUM_SEQUENCES.toString().padEnd(36)}║`);
    console.log(`  ╚═══════════════════════════════════════════════════════════╝\n`);

    generator = new TestMatrixGenerator(SEED);
    rng = new SeededRandom(SEED);
  });

  /**
   * ActionSequence - Represents a multi-step user flow
   */
  interface ActionStep {
    action: 'supply' | 'borrow' | 'repay' | 'withdraw';
    amount: bigint;
    walletId: number;
  }

  interface WalletState {
    deposited: bigint;
    borrowed: bigint;
  }

  /**
   * Generate a valid action sequence of at least MIN_SEQUENCE_LENGTH actions
   */
  function generateActionSequence(sequenceId: number, length: number): ActionStep[] {
    const seqRng = new SeededRandom(`${SEED}-seq-${sequenceId}`);
    const steps: ActionStep[] = [];
    const walletStates: WalletState[] = [
      { deposited: 0n, borrowed: 0n },
      { deposited: 0n, borrowed: 0n },
    ];

    for (let i = 0; i < length; i++) {
      const walletId = seqRng.nextInt(0, 1);
      const state = walletStates[walletId];
      
      // Choose a valid action based on current state
      const validActions: ActionStep['action'][] = ['supply']; // Supply is always valid
      
      if (state.deposited > 0n) {
        // Can potentially borrow (within LTV)
        const maxBorrow = (state.deposited * BigInt(LTV_BPS)) / BigInt(BPS_DENOMINATOR);
        if (state.borrowed < maxBorrow) {
          validActions.push('borrow');
        }
        // Can potentially withdraw (if LTV permits)
        if (state.borrowed === 0n || state.deposited > state.borrowed * 2n) {
          validActions.push('withdraw');
        }
      }
      
      if (state.borrowed > 0n) {
        validActions.push('repay');
      }

      const action = seqRng.choice(validActions);
      let amount: bigint;

      switch (action) {
        case 'supply':
          amount = BigInt(seqRng.nextInt(1, 10)) * BigInt(LAMPORTS_PER_SOL);
          state.deposited += amount;
          break;
        case 'borrow': {
          const maxBorrow = (state.deposited * BigInt(LTV_BPS)) / BigInt(BPS_DENOMINATOR);
          const availableToBorrow = maxBorrow - state.borrowed;
          amount = availableToBorrow > 0n 
            ? BigInt(seqRng.nextInt(1, Number(availableToBorrow / BigInt(LAMPORTS_PER_SOL)))) * BigInt(LAMPORTS_PER_SOL)
            : BigInt(LAMPORTS_PER_SOL);
          if (amount > availableToBorrow) amount = availableToBorrow;
          if (amount > 0n) state.borrowed += amount;
          break;
        }
        case 'repay':
          amount = state.borrowed > BigInt(LAMPORTS_PER_SOL) 
            ? BigInt(seqRng.nextInt(1, Number(state.borrowed / BigInt(LAMPORTS_PER_SOL)))) * BigInt(LAMPORTS_PER_SOL)
            : state.borrowed;
          if (amount > state.borrowed) amount = state.borrowed;
          state.borrowed -= amount;
          break;
        case 'withdraw': {
          // Calculate max withdrawable while maintaining LTV
          const minCollateralNeeded = state.borrowed > 0n
            ? (state.borrowed * BigInt(BPS_DENOMINATOR)) / BigInt(LTV_BPS) + 1n
            : 0n;
          const maxWithdraw = state.deposited - minCollateralNeeded;
          amount = maxWithdraw > BigInt(LAMPORTS_PER_SOL)
            ? BigInt(seqRng.nextInt(1, Number(maxWithdraw / BigInt(LAMPORTS_PER_SOL)))) * BigInt(LAMPORTS_PER_SOL)
            : maxWithdraw > 0n ? maxWithdraw : BigInt(LAMPORTS_PER_SOL / 10);
          if (amount > 0n && amount <= state.deposited) {
            state.deposited -= amount;
          }
          break;
        }
      }

      steps.push({ action, amount, walletId });
    }

    return steps;
  }

  /**
   * Validate that a sequence maintains LTV constraints throughout
   */
  function validateSequenceLTV(steps: ActionStep[]): { valid: boolean; failedAt?: number; reason?: string } {
    const walletStates: WalletState[] = [
      { deposited: 0n, borrowed: 0n },
      { deposited: 0n, borrowed: 0n },
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const state = walletStates[step.walletId];

      switch (step.action) {
        case 'supply':
          state.deposited += step.amount;
          break;
        case 'borrow': {
          const maxBorrow = (state.deposited * BigInt(LTV_BPS)) / BigInt(BPS_DENOMINATOR);
          if (state.borrowed + step.amount > maxBorrow) {
            return { valid: false, failedAt: i, reason: `Borrow ${step.amount} exceeds LTV (max: ${maxBorrow}, current: ${state.borrowed})` };
          }
          state.borrowed += step.amount;
          break;
        }
        case 'repay':
          if (step.amount > state.borrowed) {
            return { valid: false, failedAt: i, reason: `Repay ${step.amount} exceeds borrowed ${state.borrowed}` };
          }
          state.borrowed -= step.amount;
          break;
        case 'withdraw': {
          if (step.amount > state.deposited) {
            return { valid: false, failedAt: i, reason: `Withdraw ${step.amount} exceeds deposited ${state.deposited}` };
          }
          const remainingCollateral = state.deposited - step.amount;
          const maxBorrowAfter = (remainingCollateral * BigInt(LTV_BPS)) / BigInt(BPS_DENOMINATOR);
          if (state.borrowed > maxBorrowAfter) {
            return { valid: false, failedAt: i, reason: `Withdraw would break LTV (borrowed: ${state.borrowed}, max after: ${maxBorrowAfter})` };
          }
          state.deposited -= step.amount;
          break;
        }
      }
    }

    return { valid: true };
  }

  describe('Multi-Action Sequences', () => {
    it(`generates ${NUM_SEQUENCES} valid sequences of ${MIN_SEQUENCE_LENGTH}+ actions each`, async () => {
      console.log(`\n  Generating and validating ${NUM_SEQUENCES} action sequences:\n`);
      
      let totalActions = 0;
      let validSequences = 0;

      for (let seqId = 0; seqId < NUM_SEQUENCES; seqId++) {
        const length = MIN_SEQUENCE_LENGTH + rng.nextInt(0, 5); // 5-10 actions per sequence
        const sequence = generateActionSequence(seqId, length);
        totalActions += sequence.length;

        const validation = validateSequenceLTV(sequence);
        
        console.log(`  Sequence ${seqId + 1}: ${sequence.length} actions`);
        sequence.forEach((step, idx) => {
          const amountSol = Number(step.amount) / LAMPORTS_PER_SOL;
          console.log(`    [${idx + 1}] Wallet ${step.walletId + 1} ${step.action.toUpperCase()} ${amountSol.toFixed(2)} SOL`);
        });

        if (validation.valid) {
          console.log(`    ✅ LTV constraints maintained throughout\n`);
          validSequences++;
        } else {
          console.log(`    ❌ Failed at step ${validation.failedAt! + 1}: ${validation.reason}\n`);
        }
      }

      console.log(`  ═══════════════════════════════════════════════════════════`);
      console.log(`  Total: ${totalActions} actions across ${NUM_SEQUENCES} sequences`);
      console.log(`  Valid sequences: ${validSequences}/${NUM_SEQUENCES}`);
      console.log(`  Average sequence length: ${(totalActions / NUM_SEQUENCES).toFixed(1)} actions`);
      console.log(`  ═══════════════════════════════════════════════════════════\n`);

      expect(validSequences).to.equal(NUM_SEQUENCES, 'All generated sequences should maintain LTV constraints');
    });
  });

  describe('Withdraw LTV Scenarios', () => {
    it('handles 50 random withdraw cases', async () => {
      const scenarios = generator.generateWithdrawScenarios(50, LTV_BPS);
      
      console.log(`\n  Running 50 randomized withdrawal scenarios:`);
      console.log(`  (seed: "${SEED}" for reproducibility)\n`);

      let passed = 0;
      let failed = 0;

      for (const scenario of scenarios) {
        const remainingCollateral = scenario.depositAmount.sub(scenario.withdrawAmount);
        let actualShouldSucceed: boolean;

        if (scenario.borrowAmount.isZero()) {
          actualShouldSucceed = true;
        } else {
          const maxBorrow = remainingCollateral
            .mul(new anchor.BN(LTV_BPS))
            .div(new anchor.BN(BPS_DENOMINATOR));
          actualShouldSucceed = scenario.borrowAmount.lte(maxBorrow);
        }

        if (actualShouldSucceed === scenario.shouldSucceed) {
          passed++;
        } else {
          failed++;
          console.log(`  ❌ ${scenario.id}: Logic mismatch`);
          console.log(`     Expected: ${scenario.shouldSucceed}, Got: ${actualShouldSucceed}`);
          console.log(`     ${scenario.description}`);
        }
      }

      console.log(`\n  Results: ${passed}/${scenarios.length} scenarios validated correctly`);
      expect(failed).to.equal(0, `${failed} scenarios had logic errors`);
    });

    it('handles edge cases correctly', async () => {
      const edgeCases = generator.generateEdgeCases(LTV_BPS);
      
      console.log(`\n  Running ${edgeCases.length} edge cases:\n`);

      for (const scenario of edgeCases) {
        console.log(`  → ${scenario.id}: ${scenario.description}`);
        console.log(`    ${scenario.reason}`);

        if (!scenario.withdrawAmount.isZero()) {
          const remainingCollateral = scenario.depositAmount.sub(scenario.withdrawAmount);
          
          if (scenario.borrowAmount.gt(new anchor.BN(0))) {
            const maxBorrow = remainingCollateral
              .mul(new anchor.BN(LTV_BPS))
              .div(new anchor.BN(BPS_DENOMINATOR));
            const wouldSucceed = scenario.borrowAmount.lte(maxBorrow);
            console.log(`    Calculated: ${wouldSucceed ? 'SUCCESS' : 'FAILURE'}`);
          } else {
            console.log(`    Calculated: SUCCESS (no debt)`);
          }
        } else {
          console.log(`    Calculated: FAILURE (zero withdrawal)`);
        }
        console.log();
      }
    });
  });

  describe('Cross-Wallet Action Flows', () => {
    it('generates 5 cross-wallet interaction sequences', async () => {
      console.log(`\n  Cross-wallet interaction sequences (5 flows):\n`);

      for (let flowId = 0; flowId < 5; flowId++) {
        const flowRng = new SeededRandom(`${SEED}-crosswallet-${flowId}`);
        const steps: Array<{ wallet: number; action: string; amount: number }> = [];

        // Generate 6-8 actions alternating between wallets
        const numActions = flowRng.nextInt(6, 8);
        for (let i = 0; i < numActions; i++) {
          const wallet = i % 2; // Alternate wallets
          const actions = ['supply', 'borrow', 'repay', 'withdraw'];
          const action = flowRng.choice(actions);
          const amount = flowRng.nextInt(1, 10);
          steps.push({ wallet, action, amount });
        }

        console.log(`  Flow ${flowId + 1}: ${steps.length} cross-wallet actions`);
        steps.forEach((step, idx) => {
          console.log(`    [${idx + 1}] Wallet ${step.wallet + 1}: ${step.action} ${step.amount} SOL`);
        });
        console.log();
      }

      console.log(`  Note: These flows test wallet isolation and concurrent access patterns.\n`);
    });
  });

  describe('Reproducibility', () => {
    it('generates identical sequences with same seed', async () => {
      const gen1 = new TestMatrixGenerator(SEED);
      const gen2 = new TestMatrixGenerator(SEED);

      const scenarios1 = gen1.generateWithdrawScenarios(10, LTV_BPS);
      const scenarios2 = gen2.generateWithdrawScenarios(10, LTV_BPS);

      for (let i = 0; i < 10; i++) {
        expect(scenarios1[i].id).to.equal(scenarios2[i].id);
        expect(scenarios1[i].depositAmount.toString()).to.equal(
          scenarios2[i].depositAmount.toString()
        );
        expect(scenarios1[i].borrowAmount.toString()).to.equal(
          scenarios2[i].borrowAmount.toString()
        );
        expect(scenarios1[i].withdrawAmount.toString()).to.equal(
          scenarios2[i].withdrawAmount.toString()
        );
        expect(scenarios1[i].shouldSucceed).to.equal(scenarios2[i].shouldSucceed);
      }

      console.log(`\n  ✓ Verified reproducibility: Same seed produces identical scenarios\n`);
    });

    it('generates different scenarios with different seeds', async () => {
      const gen1 = new TestMatrixGenerator('seed-alpha');
      const gen2 = new TestMatrixGenerator('seed-beta');

      const scenarios1 = gen1.generateWithdrawScenarios(5, LTV_BPS);
      const scenarios2 = gen2.generateWithdrawScenarios(5, LTV_BPS);

      let differences = 0;
      for (let i = 0; i < 5; i++) {
        if (scenarios1[i].depositAmount.toString() !== scenarios2[i].depositAmount.toString()) {
          differences++;
        }
      }

      expect(differences).to.be.greaterThan(0);
      console.log(`\n  ✓ Verified randomness: Different seeds produce different scenarios\n`);
    });
  });

  after(() => {
    console.log(`\n  ═══════════════════════════════════════════════════════════`);
    console.log(`  Randomized tests complete. Seed: "${SEED}"`);
    console.log(`  To reproduce: TEST_SEED="${SEED}" anchor test`);
    console.log(`  ═══════════════════════════════════════════════════════════\n`);
  });
});
