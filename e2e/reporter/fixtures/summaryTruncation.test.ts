import { expect, it } from '@rstest/core';

it('reports a long diff', () => {
  expect([
    'received first line',
    ...Array.from(
      { length: 40 },
      (_, index) => `received context line ${index}`,
    ),
    'received last line',
  ]).toEqual([
    'expected first line',
    ...Array.from(
      { length: 40 },
      (_, index) => `expected context line ${index}`,
    ),
    'expected last line',
  ]);
});
