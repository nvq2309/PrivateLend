import seedrandom from 'seedrandom';

/**
 * SeededRandom - Deterministic random number generator for reproducible tests
 * Uses the seedrandom library for consistent results across test runs
 */
export class SeededRandom {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  /**
   * Generate a random integer in range [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  /**
   * Generate a random BigInt in range [min, max] (inclusive)
   * Note: For very large ranges, precision may be limited
   */
  nextBigInt(min: bigint, max: bigint): bigint {
    const range = max - min + 1n;
    const randomFraction = this.rng();
    const randomValue = BigInt(Math.floor(Number(range) * randomFraction));
    return min + randomValue;
  }

  /**
   * Pick a random element from an array
   */
  choice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Generate a random boolean with given probability of true
   */
  nextBoolean(probability: number = 0.5): boolean {
    return this.rng() < probability;
  }

  /**
   * Shuffle an array using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Generate a random number in range [min, max)
   */
  nextFloat(min: number = 0, max: number = 1): number {
    return min + this.rng() * (max - min);
  }
}

/**
 * Convenience function to create a TestRng for use in tests
 */
export const createTestRng = (seed: string): SeededRandom => {
  return new SeededRandom(seed);
};

export type TestRng = SeededRandom;
