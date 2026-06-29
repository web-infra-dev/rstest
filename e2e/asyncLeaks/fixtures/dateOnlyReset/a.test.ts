import { expect, rstest, test } from '@rstest/core';

// Pin a Date-only mock and intentionally do NOT call useRealTimers(). Under
// --detectAsyncLeaks + isolate:false the worker cleanup must undo it so the
// next file (b.test) does not inherit the mocked Date.
test('a: pins a date-only system time and leaves it active', () => {
  rstest.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
  expect(new Date().getUTCFullYear()).toBe(2000);
});
