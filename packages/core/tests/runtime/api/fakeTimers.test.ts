import { runInNewContext } from 'node:vm';
import { setRealTimers } from '../../../src/runtime/util';
import { createUtilities } from './helpers';

describe('fake timers API', () => {
  beforeEach(() => {
    setRealTimers();
  });

  it('useFakeTimers not throws when specifies `toNotFake`', async () => {
    const rs = await createUtilities();

    expect(() =>
      rs.useFakeTimers({ toNotFake: ['setImmediate'] }),
    ).not.toThrow();

    rs.useRealTimers();
  });

  it('useFakeTimers filters out timers in toNotFake', async () => {
    const rs = await createUtilities();

    rs.useFakeTimers({ toNotFake: ['setTimeout'] });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5);

    rs.advanceTimersByTime(10); // proves that setTimeout is not mocked
    expect(fired).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fired).toBe(true);

    rs.useRealTimers();
  });

  it('advanceTimersByTime accepts string durations', async () => {
    const rs = await createUtilities();
    rs.useFakeTimers({ now: 0 });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 1000);

    rs.advanceTimersByTime('00:01');

    expect(fired).toBe(true);
    expect(Date.now()).toBe(1000);

    rs.useRealTimers();
  });

  it('setSystemTime accepts Temporal-like values', async () => {
    const rs = await createUtilities();
    rs.useFakeTimers({ now: 0 });

    rs.setSystemTime({ epochMilliseconds: 1234 });

    expect(Date.now()).toBe(1234);

    rs.useRealTimers();
  });

  describe('setSystemTime without a prior useFakeTimers', () => {
    const pinned = new Date('2025-01-01T00:00:00.000Z');
    let rs: Awaited<ReturnType<typeof createUtilities>>;

    beforeEach(async () => {
      rs = await createUtilities();
    });

    afterEach(() => {
      rs.useRealTimers();
    });

    it('pins the clock to the given date', () => {
      rs.setSystemTime(pinned);

      expect(new Date().toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(Date.now()).toBe(pinned.getTime());
    });

    it('leaves the timer APIs unmocked', async () => {
      rs.setSystemTime(0);

      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 5);

      // Only `Date` is faked, so there is no fake clock to advance...
      expect(rs.isFakeTimers()).toBe(false);
      expect(() => rs.advanceTimersByTime(10)).toThrow(/not mocked/);

      // ...and the real timer still fires on its own.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fired).toBe(true);
    });

    it('still honors explicit Date arguments', () => {
      rs.setSystemTime(pinned);

      expect(new Date(2030, 5, 15).getFullYear()).toBe(2030);
      expect(new Date(Date.UTC(2030, 5, 15)).toISOString()).toBe(
        '2030-06-15T00:00:00.000Z',
      );
      // An omitted field defaults like native `Date`...
      expect(Number.isNaN(new Date(2030, 5).getTime())).toBe(false);
      // ...but an explicit `undefined`/`NaN` field yields `Invalid Date`.
      expect(Number.isNaN(new Date(2030, 5, undefined).getTime())).toBe(true);
      expect(Number.isNaN(new Date(2030, 5, 15, Number.NaN).getTime())).toBe(
        true,
      );
    });

    it('accepts a Date created in another realm', () => {
      // A Date from a different realm is not `instanceof` this realm's `Date`.
      const crossRealmDate: Date = runInNewContext(
        'new Date("2030-06-15T00:00:00.000Z")',
      );
      expect(crossRealmDate instanceof Date).toBe(false);

      expect(() => rs.setSystemTime(crossRealmDate)).not.toThrow();
      expect(new Date().toISOString()).toBe('2030-06-15T00:00:00.000Z');
    });

    it('preserves prototypes for Date subclasses defined under the mock', () => {
      rs.setSystemTime(pinned);

      class MyDate extends Date {
        greet(): string {
          return 'hi';
        }
      }
      const instance = new MyDate();

      expect(instance).toBeInstanceOf(MyDate);
      expect(instance.greet()).toBe('hi');
      // A subclass with no args still reflects the pinned time.
      expect(instance.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      // A plain Date must NOT satisfy the subclass check (the broadened
      // `instanceof` hook applies to `Date` itself, not inherited subclasses).
      expect(new Date() instanceof MyDate).toBe(false);
    });

    it('keeps the previous pin when a later setSystemTime is invalid', () => {
      rs.setSystemTime(pinned);

      expect(() => rs.setSystemTime(Number.NaN)).toThrow();

      // The failed call must not corrupt the previously pinned date.
      expect(new Date().toISOString()).toBe('2025-01-01T00:00:00.000Z');
      rs.useFakeTimers();
      expect(new Date().toISOString()).toBe('2025-01-01T00:00:00.000Z');
    });

    it('restores the real clock on useRealTimers', () => {
      rs.setSystemTime(pinned);
      rs.useRealTimers();

      expect(new Date().getFullYear()).toBeGreaterThan(2025);
    });

    it('upgrades to fake timers while keeping the pinned time', () => {
      rs.setSystemTime(pinned);
      rs.useFakeTimers();

      expect(rs.isFakeTimers()).toBe(true);
      expect(Date.now()).toBe(pinned.getTime());

      const cb = rs.fn();
      setTimeout(cb, 1000);
      rs.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('keeps instanceof Date working for dates created before the mock', () => {
      // A Date cached before the pin is a `RealDate`, not a `MockDate`, yet user
      // code validating it with `instanceof Date` must still accept it.
      const cached = new Date('2020-01-01T00:00:00.000Z');
      rs.setSystemTime(pinned);

      expect(cached instanceof Date).toBe(true);
      // A date created under the mock is still a Date too.
      expect(new Date() instanceof Date).toBe(true);
    });

    it('re-pins from a Date created before the mock was installed', () => {
      // `stored` predates the mock, so once the global `Date` is `MockDate` it
      // is no longer `instanceof globalThis.Date`.
      const stored = new Date('2030-06-15T00:00:00.000Z');
      rs.setSystemTime(pinned);

      expect(() => rs.setSystemTime(stored)).not.toThrow();
      expect(new Date().toISOString()).toBe('2030-06-15T00:00:00.000Z');
    });

    it('snapshots the pin so later mutation of the input does not leak', () => {
      const input = new Date('2025-01-01T00:00:00.000Z');
      rs.setSystemTime(input);
      input.setUTCFullYear(2099);

      // Promotion to full fake timers must keep the value set at call time.
      rs.useFakeTimers();
      expect(new Date().getUTCFullYear()).toBe(2025);
    });

    it('restores the Date-only pin after a scoped useFakeTimers disposes', () => {
      rs.setSystemTime(pinned);

      const scoped = rs.useFakeTimers();
      expect(rs.isFakeTimers()).toBe(true);
      scoped[Symbol.dispose]?.();

      // Back to the Date-only pin, not the real clock.
      expect(rs.isFakeTimers()).toBe(false);
      expect(Date.now()).toBe(pinned.getTime());
    });
  });

  it('jumpTimersByTime fires recurring timers at most once', async () => {
    const rs = await createUtilities();
    rs.useFakeTimers({ now: 0 });

    const cb = rs.fn();
    setInterval(cb, 1000);

    rs.jumpTimersByTime(5000);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(5000);

    rs.useRealTimers();
  });

  it('setTickMode supports nextAsync auto ticking', async () => {
    const rs = await createUtilities();
    rs.useFakeTimers({ now: 0 });

    const result = new Promise((resolve) => {
      setTimeout(() => resolve(Date.now()), 1000);
    });

    rs.setTickMode({ mode: 'nextAsync' });

    await expect(result).resolves.toBe(1000);

    rs.useRealTimers();
  });

  it('restores tick mode after scoped fake timers dispose', async () => {
    const rs = await createUtilities();
    rs.useFakeTimers({ now: 0 });
    rs.setTickMode({ mode: 'nextAsync' });

    const scoped = rs.useFakeTimers({ now: 100 });
    scoped[Symbol.dispose]?.();

    const result = new Promise((resolve) => {
      setTimeout(() => resolve(Date.now()), 1000);
    });

    await expect(result).resolves.toBe(1000);

    rs.useRealTimers();
  });
});
