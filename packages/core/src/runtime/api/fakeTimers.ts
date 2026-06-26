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
import { mockDate, RealDate, resetDate } from './mockDate';

export type { FakeTimerInstallOpts };

type FakeTimerTickTime = Parameters<InstalledClock['tick']>[0];
type FakeTimerSystemTime = Parameters<InstalledClock['setSystemTime']>[0];
type FakeTimerTickMode = Parameters<InstalledClock['setTickMode']>[0];

type FakeMethod = NonNullable<FakeTimerInstallOpts['toFake']>[number];

export type FakeTimersSnapshot = {
  now: number;
  timers: [number, FakeTimerRecord][];
  jobs: FakeTimerRecord[];
  tickMode: FakeTimerTickMode | undefined;
};

const cloneFakeTimerRecord = (record: FakeTimerRecord): FakeTimerRecord => ({
  ...record,
  args: record.args ? [...record.args] : undefined,
});

// Detect `Date` structurally rather than with `instanceof`, so a `Date` from
// another realm (iframe / vm context) or created via a mocked global is matched.
const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

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
  // | _fakingTime | _fakingDate |
  // +-------------+-------------+
  // | false       | falsy       | initial
  // | false       | truthy      | setSystemTime called first (mock only Date without fake timers)
  // | true        | falsy       | useFakeTimers called first
  // | true        | truthy      | unreachable
  private _fakingTime: boolean;
  private _fakingDate: Date | null;
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
    this._fakingDate = null;
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

  private _resetFakingDate(): void {
    if (this._fakingDate) {
      resetDate();
      this._fakingDate = null;
    }
  }

  useRealTimers(): void {
    this._resetFakingDate();

    if (this._fakingTime) {
      this._clock.uninstall();
      this._fakingTime = false;
    }
  }

  useFakeTimers({
    toNotFake = [],
    ...restFakeTimersConfig
  }: FakeTimerInstallOpts = {}): void {
    // Carry over the time pinned by a prior Date-only setSystemTime() so that
    // promoting to full fake timers keeps the same "now".
    const fakeDate = this._fakingDate ?? Date.now();
    this._resetFakingDate();

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
      now: fakeDate,
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
    if (this._fakingTime) {
      // `@sinonjs/fake-timers` accepts `number | Date | { epochMilliseconds }`
      // directly, so forward it untouched.
      this._clock.setSystemTime(now);
      return;
    }
    // Mock only the global `Date` without installing full fake timers, so
    // setSystemTime() works on its own (matching Vitest). Assign `_fakingDate`
    // only after `mockDate` validates the input, so an invalid value throws
    // without corrupting a previously pinned date.
    const date = this._toFakeDate(now);
    mockDate(date);
    this._fakingDate = date;
  }

  private _toFakeDate(now?: FakeTimerSystemTime): Date {
    if (now === undefined) {
      return new Date(this.getRealSystemTime());
    }
    if (typeof now === 'number') {
      return new Date(now);
    }
    // Clone the Date so a later mutation of the caller's object can't leak into
    // the pin (which a promotion or scoped restore would otherwise pick up).
    if (isDate(now)) {
      return new RealDate(now.valueOf());
    }
    // Temporal-like value, e.g. `{ epochMilliseconds }`.
    return new Date(now.epochMilliseconds);
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
      tickMode: this._clock.tickMode
        ? {
            mode: this._clock.tickMode.mode,
            delta: this._clock.tickMode.delta,
          }
        : undefined,
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
      if (snapshot.tickMode) {
        this._clock.setTickMode(snapshot.tickMode);
      }
    }
  }

  getRealSystemTime(): number {
    return RealDate.now();
  }

  /**
   * The time pinned by a Date-only `setSystemTime()` (i.e. without full fake
   * timers), or `null`. Used to restore that pin after a scoped
   * `useFakeTimers()` disposes.
   */
  getMockedSystemTime(): Date | null {
    return this._fakingDate;
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
