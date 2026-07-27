import { expect, it } from '@rstest/core';

// This file must be scheduled before `bailSecond.test.ts` so its failure
// trips the cross-file bail check for the second file. The cold scheduler
// orders new files by size (descending) before path order, so this comment
// deliberately keeps this file the larger of the two; on a warm cache the
// failed-first rule orders it first anyway.
it('failing case', () => {
  expect(1).toBe(2);
});
