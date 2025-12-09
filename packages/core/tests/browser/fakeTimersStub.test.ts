import { describe, expect, it } from '@rstest/core';
import {
  type InstalledClock,
  withGlobal,
} from '../../src/browser/client/fakeTimersStub';

describe('fakeTimersStub', () => {
  describe('withGlobal', () => {
    it('should return an object with timers and install', () => {
      const result = withGlobal(globalThis);

      expect(result).toHaveProperty('timers');
      expect(result).toHaveProperty('install');
      expect(typeof result.install).toBe('function');
    });

    it('should return empty timers object', () => {
      const result = withGlobal(globalThis);
      expect(result.timers).toEqual({});
    });
  });

  describe('install', () => {
    it('should return an InstalledClock', () => {
      const { install } = withGlobal(globalThis);
      const clock = install();

      expect(clock).toHaveProperty('now');
      expect(clock).toHaveProperty('reset');
      expect(clock).toHaveProperty('uninstall');
      expect(clock).toHaveProperty('tick');
    });

    it('should initialize now to current time', () => {
      const { install } = withGlobal(globalThis);
      const before = Date.now();
      const clock = install();
      const after = Date.now();

      expect(clock.now).toBeGreaterThanOrEqual(before);
      expect(clock.now).toBeLessThanOrEqual(after);
    });
  });

  describe('InstalledClock', () => {
    let clock: InstalledClock;

    const setup = () => {
      const { install } = withGlobal(globalThis);
      clock = install();
    };

    it('tick should advance time', () => {
      setup();
      const initialNow = clock.now;
      clock.tick(1000);

      expect(clock.now).toBe(initialNow + 1000);
    });

    it('tickAsync should advance time', async () => {
      setup();
      const initialNow = clock.now;
      await clock.tickAsync(500);

      expect(clock.now).toBe(initialNow + 500);
    });

    it('reset should reset to current time', () => {
      setup();
      clock.tick(10000);
      const before = Date.now();
      clock.reset();
      const after = Date.now();

      expect(clock.now).toBeGreaterThanOrEqual(before);
      expect(clock.now).toBeLessThanOrEqual(after);
    });

    it('setSystemTime with number should set time', () => {
      setup();
      clock.setSystemTime(1234567890);

      expect(clock.now).toBe(1234567890);
    });

    it('setSystemTime with Date should set time', () => {
      setup();
      const date = new Date('2024-01-01T00:00:00.000Z');
      clock.setSystemTime(date);

      expect(clock.now).toBe(date.valueOf());
    });

    it('setSystemTime without argument should set to current time', () => {
      setup();
      clock.tick(10000);
      const before = Date.now();
      clock.setSystemTime();
      const after = Date.now();

      expect(clock.now).toBeGreaterThanOrEqual(before);
      expect(clock.now).toBeLessThanOrEqual(after);
    });

    it('countTimers should return 0', () => {
      setup();
      expect(clock.countTimers()).toBe(0);
    });

    it('noop methods should not throw', () => {
      setup();

      expect(() => clock.uninstall()).not.toThrow();
      expect(() => clock.runAll()).not.toThrow();
      expect(() => clock.runToLast()).not.toThrow();
      expect(() => clock.next()).not.toThrow();
      expect(() => clock.runToFrame()).not.toThrow();
      expect(() => clock.runMicrotasks()).not.toThrow();
    });

    it('async noop methods should resolve', async () => {
      setup();

      await expect(clock.runAllAsync()).resolves.toBeUndefined();
      await expect(clock.runToLastAsync()).resolves.toBeUndefined();
      await expect(clock.nextAsync()).resolves.toBeUndefined();
    });
  });
});
