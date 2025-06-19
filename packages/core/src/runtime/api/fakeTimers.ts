/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of https://github.com/facebook/jest.
 */

import {
  type FakeTimerInstallOpts,
  type FakeTimerWithContext,
  type InstalledClock,
  withGlobal,
} from '@sinonjs/fake-timers';
export type { FakeTimerInstallOpts };

const RealDate = Date;

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
    this._fakeTimers = withGlobal(global);
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

  advanceTimersByTime(msToRun: number): void {
    if (this._checkFakeTimers()) {
      this._clock.tick(msToRun);
    }
  }

  async advanceTimersByTimeAsync(msToRun: number): Promise<void> {
    if (this._checkFakeTimers()) {
      await this._clock.tickAsync(msToRun);
    }
  }

  advanceTimersToNextFrame(): void {
    if (this._checkFakeTimers()) {
      this._clock.runToFrame();
    }
  }

  runAllTicks(): void {
    if (this._checkFakeTimers()) {
      // @ts-expect-error - doesn't exist?
      this._clock.runMicrotasks();
    }
  }

  useRealTimers(): void {
    if (this._fakingTime) {
      this._clock.uninstall();
      this._fakingTime = false;
    }
  }

  useFakeTimers(fakeTimersConfig: FakeTimerInstallOpts = {}): void {
    if (this._fakingTime) {
      this._clock.uninstall();
    }

    const toFake = Object.keys(this._fakeTimers.timers)
      // Do not mock timers internally used by node by default. It can still be mocked through userConfig.
      .filter(
        (timer) => timer !== 'nextTick' && timer !== 'queueMicrotask',
      ) as (keyof FakeTimerWithContext['timers'])[];

    const isChildProcess = typeof process !== 'undefined' && !!process.send;

    if (this._config?.toFake?.includes('nextTick') && isChildProcess) {
      throw new Error('process.nextTick cannot be mocked inside child_process');
    }

    this._clock = this._fakeTimers.install({
      loopLimit: 10_000,
      shouldClearNativeTimers: true,
      now: Date.now(),
      toFake: [...toFake],
      // @ts-expect-error untyped but supported
      ignoreMissingTimers: true,
      ...fakeTimersConfig,
    });

    this._fakingTime = true;
  }

  reset(): void {
    if (this._checkFakeTimers()) {
      const { now } = this._clock;
      this._clock.reset();
      this._clock.setSystemTime(now);
    }
  }

  setSystemTime(now?: number | Date): void {
    if (this._checkFakeTimers()) {
      this._clock.setSystemTime(now);
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
