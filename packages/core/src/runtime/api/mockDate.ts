/**
 * Ported from https://github.com/boblauer/MockDate/blob/master/src/mockdate.ts
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Bob Lauer
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 */

type MockDateConstructor = {
  new (): Date;
  new (value: number | string | Date): Date;
  new (
    year: number,
    month: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number,
  ): Date;
  readonly prototype: Date;
  now(): number;
  parse(dateString: string): number;
  UTC(
    year: number,
    monthIndex?: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number,
  ): number;
};

type MockDateState = {
  MockDate: MockDateConstructor;
  RealDate: DateConstructor;
  setNow: (value: number) => void;
};

const states = new WeakMap<object, MockDateState>();

const createMockDateState = (target: typeof globalThis): MockDateState => {
  const RealmDate = target.Date;
  let now: number | null = null;

  class MockDate extends RealmDate {
    constructor();
    constructor(value: number | string | Date);
    constructor(
      year: number,
      month: number,
      date?: number,
      hours?: number,
      minutes?: number,
      seconds?: number,
      ms?: number,
    );
    constructor(
      ...args:
        | []
        | [value: number | string | Date]
        | [
            year: number,
            month: number,
            date?: number,
            hours?: number,
            minutes?: number,
            seconds?: number,
            ms?: number,
          ]
    ) {
      super();

      let date: Date;
      if (args.length === 0) {
        date = now !== null ? new RealmDate(now) : new RealmDate();
      } else if (args.length === 1) {
        date = new RealmDate(args[0]);
      } else {
        // Forward the arguments verbatim so native coercion is preserved — e.g.
        // an explicit `undefined`/`NaN` field yields `Invalid Date`, while an
        // omitted field still defaults the same way the native `Date` does.
        date = new RealmDate(...args);
      }

      // Re-point the freshly built RealmDate at the actual construction target's
      // prototype (`new.target`), not a hard-coded `MockDate.prototype`. For
      // `new Date()` that is `MockDate`; for `class X extends Date` it is `X`, so
      // `instanceof X` and the subclass's own members are preserved like native.
      Object.setPrototypeOf(date, new.target.prototype);

      // The constructor of a subclass implicitly returns `this`, but here we
      // return that freshly built RealmDate so the mocked "now" is honored for
      // the zero-argument case.
      // eslint-disable-next-line no-constructor-return
      return date;
    }
  }

  // Make `instanceof Date` recognize every Date from this realm, including ones
  // built before the global was swapped. The guard contains this deliberate
  // Vitest divergence so subclasses retain native `instanceof` behavior.
  Object.defineProperty(MockDate, Symbol.hasInstance, {
    value(this: unknown, instance: unknown): boolean {
      if (this !== MockDate) {
        return Function.prototype[Symbol.hasInstance].call(this, instance);
      }
      return instance instanceof RealmDate;
    },
  });

  MockDate.UTC = RealmDate.UTC;
  MockDate.now = () => new MockDate().valueOf();
  MockDate.parse = (dateString: string) => RealmDate.parse(dateString);
  MockDate.toString = () => RealmDate.toString();

  return {
    MockDate,
    RealDate: RealmDate,
    setNow(value) {
      now = value;
    },
  };
};

export function mockDate(
  date: string | number | Date,
  target: typeof globalThis = globalThis,
): void {
  let state = states.get(target);
  if (!state) {
    state = createMockDateState(target);
    states.set(target, state);
  }
  const dateObj = new state.RealDate(date.valueOf());
  if (Number.isNaN(dateObj.getTime())) {
    throw new TypeError(`mockdate: The time set is an invalid date: ${date}`);
  }

  // MockDate intentionally omits `Date`'s callable-without-new string overload.
  // @ts-expect-error overriding the global Date constructor
  target.Date = state.MockDate;

  state.setNow(dateObj.valueOf());
}

export function resetDate(target: typeof globalThis = globalThis): void {
  const state = states.get(target);
  if (!state) {
    return;
  }
  target.Date = state.RealDate;
  states.delete(target);
}
