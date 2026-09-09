import { expect, it } from '@rstest/core';

// Regression: invalid `repeats` values (negative, NaN, fractional) must not
// cause the runner to silently skip the test — they should clamp to 0.
let neg = 0;
it('negative repeats clamps to a single run', { repeats: -3 }, () => {
  neg++;
  expect(neg).toBe(1);
});

let nan = 0;
it('NaN repeats clamps to a single run', { repeats: Number.NaN }, () => {
  nan++;
  expect(nan).toBe(1);
});

let frac = 0;
it('fractional repeats floors', { repeats: 1.9 }, () => {
  frac++;
  expect(frac).toBeGreaterThanOrEqual(1);
  expect(frac).toBeLessThanOrEqual(2);
});
