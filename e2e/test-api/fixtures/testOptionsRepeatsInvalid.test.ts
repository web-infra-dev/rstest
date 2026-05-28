import { expect, it } from '@rstest/core';

// Regression: invalid `repeats` values (negative, NaN, fractional) must not
// cause the runner to silently skip the test — they should clamp to 0.
let neg = 0;
it(
  'negative repeats clamps to a single run',
  () => {
    neg++;
    expect(neg).toBe(1);
  },
  { repeats: -3 },
);

let nan = 0;
it(
  'NaN repeats clamps to a single run',
  () => {
    nan++;
    expect(nan).toBe(1);
  },
  { repeats: Number.NaN },
);

let frac = 0;
it(
  'fractional repeats floors',
  () => {
    frac++;
    expect(frac).toBeGreaterThanOrEqual(1);
    expect(frac).toBeLessThanOrEqual(2);
  },
  { repeats: 1.9 },
);
