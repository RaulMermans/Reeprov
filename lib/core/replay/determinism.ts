/**
 * Deterministic Replay Utilities: Clock and Randomness.
 *
 * Provides replay-scoped deterministic time and pseudo-random numbers
 * without uncontained global monkey-patching.
 */

export class ReplayClock {
  private currentMs: number;
  private readonly stepAdvanceMs: number;

  constructor(initialEpochMs: number | string | Date = 1775808000000, stepAdvanceMs: number = 10) {
    if (typeof initialEpochMs === "string") {
      this.currentMs = Date.parse(initialEpochMs);
    } else if (initialEpochMs instanceof Date) {
      this.currentMs = initialEpochMs.getTime();
    } else {
      this.currentMs = initialEpochMs;
    }
    this.stepAdvanceMs = stepAdvanceMs;
  }

  /**
   * Returns simulated current epoch timestamp in milliseconds, advancing time slightly
   * per invocation to maintain strict monotonicity.
   */
  now(): number {
    const time = this.currentMs;
    this.currentMs += this.stepAdvanceMs;
    return time;
  }

  toISOString(): string {
    return new Date(this.now()).toISOString();
  }

  advance(ms: number): void {
    this.currentMs += Math.max(0, ms);
  }
}

export class ReplayRandom {
  private state: number;

  constructor(seed: number | string = 1337) {
    if (typeof seed === "string") {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash |= 0;
      }
      this.state = Math.abs(hash) || 1;
    } else {
      this.state = Math.abs(seed) || 1;
    }
  }

  /**
   * Returns a deterministic pseudo-random float in [0, 1).
   * Implements a standard Park-Miller LCG.
   */
  random(): number {
    this.state = (this.state * 48271) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  nextFloat(): number {
    return this.random();
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
}
