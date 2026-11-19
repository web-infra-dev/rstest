import type { Duration } from '../../types';

/** Shared by the executors that build and run the initial selection in parallel. */
export class RunTimer {
  private readonly start = performance.now();
  private buildTime?: number;
  private buildFinished = false;
  private runningGroups = 0;
  private groupWindowStart = 0;
  private overlappingTestTime = 0;
  private prebundleTime?: Record<string, number>;

  recordPrebundle = (name: string, elapsed: number): void => {
    this.prebundleTime ??= {};
    this.prebundleTime[name] = (this.prebundleTime[name] ?? 0) + elapsed;
  };

  startTests(): void {
    this.buildTime ??= Math.round(performance.now() - this.start);
  }

  finishBuild(): void {
    const now = performance.now();
    if (this.runningGroups > 0) {
      this.overlappingTestTime += now - this.groupWindowStart;
    }
    this.buildTime = Math.round(now - this.start);
    this.buildFinished = true;
  }

  startTestGroup(): (() => void) | undefined {
    if (this.buildFinished) return;
    if (this.runningGroups++ === 0) {
      this.groupWindowStart = performance.now();
    }
    return () => {
      if (--this.runningGroups === 0 && !this.buildFinished) {
        this.overlappingTestTime += performance.now() - this.groupWindowStart;
      }
    };
  }

  finish(): Duration {
    const totalTime = Math.round(performance.now() - this.start);
    const buildTime = this.buildTime ?? totalTime;
    return {
      totalTime,
      buildTime,
      testTime: totalTime - buildTime + Math.round(this.overlappingTestTime),
      ...(this.prebundleTime && { prebundleTime: this.prebundleTime }),
    };
  }
}
