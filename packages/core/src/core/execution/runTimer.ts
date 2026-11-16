import type { Duration } from '../../types';

/** Shared by the executors that build and run the initial selection in parallel. */
export class RunTimer {
  private readonly start = performance.now();
  private buildTime?: number;
  private prebundleTime?: Record<string, number>;

  recordPrebundle = (name: string, elapsed: number): void => {
    this.prebundleTime ??= {};
    this.prebundleTime[name] = (this.prebundleTime[name] ?? 0) + elapsed;
  };

  startTests(): void {
    this.buildTime = Math.round(performance.now() - this.start);
  }

  finish(): Duration {
    const totalTime = Math.round(performance.now() - this.start);
    const buildTime = this.buildTime ?? totalTime;
    return {
      totalTime,
      buildTime,
      testTime: totalTime - buildTime,
      ...(this.prebundleTime && { prebundleTime: this.prebundleTime }),
    };
  }
}
