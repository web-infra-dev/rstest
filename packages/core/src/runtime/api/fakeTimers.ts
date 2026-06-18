/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of https://github.com/facebook/jest.
 */

import type {
  Config as FakeTimerInstallOpts,
  FakeTimers as FakeTimerWithContext,
  Clock as InstalledClock,
  Timer as FakeTimerRecord,
} from '@sinonjs/fake-timers';

export type { FakeTimerInstallOpts };

type FakeTimerTickTime = Parameters<InstalledClock['tick']>[0];
type FakeTimerSystemTime = Parameters<InstalledClock['setSystemTime']>[0];
type FakeTimerTickMode = Parameters<InstalledClock['setTickMode']>[0];

const RealDate = Date;
type FakeMethod = NonNullable<FakeTimerInstallOpts['toFake']>[number];

export type FakeTimersSnapshot = {
  now: number;
  timers: [number, FakeTimerRecord][];
  jobs: FakeTimerRecord[];
};

const cloneFakeTimerRecord = (record: FakeTimerRecord): FakeTimerRecord => ({
  ...record,
  args: record.args ? [...record.args] : undefined,
});

const loadFakeTimersModule = () => {
  // TODO: Switch back to createRequire(import.meta.url) once Rspack supports
  // preserving that pattern without breaking bundling/runtime resolution.
  // Preserve the public sync timer API while avoiding module init work
  // on worker startup when fake timers are never used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const loaded = require('@sinonjs/fake-timers');
  return { withGlobal: loaded.withGlobal };
};

export class FakeTimers {
  private _clock!: InstalledClock;
  private readonly _config: FakeTimerInstallOpts;
  private _fakingTime: boolean;
  private readonly _fakeTimers: FakeTimerWithContext;

  constructor({
    global,
    config = {},
  }: {
    global: typeof globalThis;
    config?: FakeTimerInstallOpts;
  }) {
    this._config = config;
    this._fakingTime = false;
    this._fakeTimers = loadFakeTimersModule().withGlobal(global);
  }

  clearAllTimers(): void {
    if (this._fakingTime) {
      this._clock.reset();
    }
  }

  dispose(): void {
    this.useRealTimers();
  }

  runAllTimers(): void {
    if (this._checkFakeTimers()) {
      this._clock.runAll();
    }
  }

  async runAllTimersAsync(): Promise<void> {
    if (this._checkFakeTimers()) {
      await this._clock.runAllAsync();
    }
  }

  runOnlyPendingTimers(): void {
    if (this._checkFakeTimers()) {
      this._clock.runToLast();
    }
  }

  async runOnlyPendingTimersAsync(): Promise<void> {
    if (this._checkFakeTimers()) {
      await this._clock.runToLastAsync();
    }
  }

  advanceTimersToNextTimer(steps = 1): void {
    if (this._checkFakeTimers()) {
      for (let i = steps; i > 0; i--) {
        this._clock.next();
        // Fire all timers at this point: https://github.com/sinonjs/fake-timers/issues/250
        this._clock.tick(0);

        if (this._clock.countTimers() === 0) {
          break;
        }
      }
    }
  }

  async advanceTimersToNextTimerAsync(steps = 1): Promise<void> {
    if (this._checkFakeTimers()) {
      for (let i = steps; i > 0; i--) {
        await this._clock.nextAsync();
        // Fire all timers at this point: https://github.com/sinonjs/fake-timers/issues/250
        await this._clock.tickAsync(0);

        if (this._clock.countTimers() === 0) {
          break;
        }
      }
    }
  }

  advanceTimersByTime(msToRun: FakeTimerTickTime): void {
    if (this._checkFakeTimers()) {
      this._clock.tick(msToRun);
    }
  }

  async advanceTimersByTimeAsync(msToRun: FakeTimerTickTime): Promise<void> {
    if (this._checkFakeTimers()) {
      await this._clock.tickAsync(msToRun);
    }
  }

  jumpTimersByTime(msToRun: FakeTimerTickTime): void {
    if (this._checkFakeTimers()) {
      this._clock.jump(msToRun);
    }
  }

  setTickMode(mode: FakeTimerTickMode): void {
    if (this._checkFakeTimers()) {
      this._clock.setTickMode(mode);
    }
  }

  advanceTimersToNextFrame(): void {
    if (this._checkFakeTimers()) {
      this._clock.runToFrame();
    }
  }

  runAllTicks(): void {
    if (this._checkFakeTimers()) {
      this._clock.runMicrotasks();
    }
  }

  useRealTimers(): void {
    if (this._fakingTime) {
      this._clock.uninstall();
      this._fakingTime = false;
    }
  }

  useFakeTimers({
    toNotFake = [],
    ...restFakeTimersConfig
  }: FakeTimerInstallOpts = {}): void {
    if (this._fakingTime) {
      this._clock.uninstall();
    }

    const ignoreTimers = ['Intl', 'nextTick', 'queueMicrotask'].concat(
      toNotFake,
    );

    const toFake = Object.keys(this._fakeTimers.timers)
      // Do not mock timers internally used by node by default. It can still be mocked through userConfig.
      .filter((timer): timer is FakeMethod => !ignoreTimers.includes(timer));

    const isChildProcess = typeof process !== 'undefined' && !!process.send;

    if (this._config?.toFake?.includes('nextTick') && isChildProcess) {
      throw new Error('process.nextTick cannot be mocked inside child_process');
    }

    this._clock = this._fakeTimers.install({
      loopLimit: 10_000,
      shouldClearNativeTimers: true,
      now: Date.now(),
      toFake: [...toFake],
      ignoreMissingTimers: true,
      ...restFakeTimersConfig,
    });

    // temporary fix fake-timers 15.1.1 → 15.2.0 timerHeap.push error
    this._clock.reset();
    this._fakingTime = true;
  }

  reset(): void {
    if (this._checkFakeTimers()) {
      const { now } = this._clock;
      this._clock.reset();
      this._clock.setSystemTime(now);
    }
  }

  setSystemTime(now?: FakeTimerSystemTime): void {
    if (this._checkFakeTimers()) {
      this._clock.setSystemTime(now);
    }
  }

  snapshot(): FakeTimersSnapshot | undefined {
    if (!this._fakingTime) {
      return undefined;
    }

    return {
      now: this._clock.now,
      timers: [...(this._clock.timers ?? new Map())].map(([id, timer]) => [
        id,
        cloneFakeTimerRecord(timer),
      ]),
      jobs: (this._clock.jobs ?? []).map(cloneFakeTimerRecord),
    };
  }

  restore(snapshot: FakeTimersSnapshot): void {
    if (this._checkFakeTimers()) {
      this._clock.setSystemTime(snapshot.now);
      const timerEntries = snapshot.timers.map(([id, timer]) => [
        id,
        cloneFakeTimerRecord(timer),
      ]) as [number, FakeTimerRecord][];
      const timers = timerEntries.map(([, timer]) => timer);
      this._clock.timers = new Map(timerEntries);
      if (this._clock.timerHeap) {
        this._clock.timerHeap.timers = [];
        for (const timer of timers) {
          this._clock.timerHeap.push(timer);
        }
      }
      this._clock.jobs = snapshot.jobs.map(cloneFakeTimerRecord);
    }
  }

  getRealSystemTime(): number {
    return RealDate.now();
  }

  now(): number {
    if (this._fakingTime) {
      return this._clock.now;
    }
    return Date.now();
  }

  getTimerCount(): number {
    if (this._checkFakeTimers()) {
      return this._clock.countTimers();
    }

    return 0;
  }

  private _checkFakeTimers() {
    if (!this._fakingTime) {
      throw new Error(
        'Timers are not mocked. Try calling "rstest.useFakeTimers()" first.',
      );
    }

    return this._fakingTime;
  }

  isFakeTimers(): boolean {
    return this._fakingTime;
  }
}
