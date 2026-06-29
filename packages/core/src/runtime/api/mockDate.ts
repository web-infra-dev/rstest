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

export const RealDate: DateConstructor = Date;

let now: number | null = null;

class MockDate extends RealDate {
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
      date = now !== null ? new RealDate(now) : new RealDate();
    } else if (args.length === 1) {
      date = new RealDate(args[0]);
    } else {
      // Forward the arguments verbatim so native coercion is preserved — e.g.
      // an explicit `undefined`/`NaN` field yields `Invalid Date`, while an
      // omitted field still defaults the same way the native `Date` does.
      date = new RealDate(...args);
    }

    // Re-point the freshly built RealDate at the actual construction target's
    // prototype (`new.target`), not a hard-coded `MockDate.prototype`. For
    // `new Date()` that is `MockDate`; for `class X extends Date` it is `X`, so
    // `instanceof X` and the subclass's own members are preserved like native.
    Object.setPrototypeOf(date, new.target.prototype);

    // The constructor of a subclass implicitly returns `this`, but here we
    // return that freshly built RealDate so the mocked "now" is honored for the
    // zero-argument case.
    // eslint-disable-next-line no-constructor-return
    return date;
  }
}

// Make `instanceof Date` recognize every real Date, including ones built before
// the global was swapped (cached/imported values). Without this only
// MockDate-constructed dates pass, so user validation of a pre-existing Date
// would wrongly reject it under the date-only clock.
//
// NOTE: this hook is a DELIBERATE divergence from Vitest's port, which has no
// `Symbol.hasInstance` at all. The `this !== MockDate` guard below exists solely
// to contain that divergence (subclasses must not inherit the broadened check),
// so do not "simplify" it away — dropping it reintroduces the subclass leak
// where `new Date() instanceof (class X extends Date {})` wrongly returns true.
Object.defineProperty(MockDate, Symbol.hasInstance, {
  value(this: unknown, instance: unknown): boolean {
    // This static hook is inherited by `class X extends Date` subclasses, so
    // only broaden `instanceof` for `Date`/`MockDate` itself. Subclasses fall
    // back to the native algorithm, otherwise every real Date would wrongly
    // satisfy `x instanceof X`.
    if (this !== MockDate) {
      return Function.prototype[Symbol.hasInstance].call(this, instance);
    }
    return instance instanceof RealDate;
  },
});

MockDate.UTC = RealDate.UTC;

MockDate.now = function now() {
  return new MockDate().valueOf();
};

MockDate.parse = function parse(dateString: string) {
  return RealDate.parse(dateString);
};

MockDate.toString = function toString() {
  return RealDate.toString();
};

export function mockDate(date: string | number | Date): void {
  const dateObj = new RealDate(date.valueOf());
  if (Number.isNaN(dateObj.getTime())) {
    throw new TypeError(`mockdate: The time set is an invalid date: ${date}`);
  }

  // MockDate intentionally omits `Date`'s callable-without-new string overload.
  // @ts-expect-error overriding the global Date constructor
  globalThis.Date = MockDate;

  now = dateObj.valueOf();
}

export function resetDate(): void {
  globalThis.Date = RealDate;
}
