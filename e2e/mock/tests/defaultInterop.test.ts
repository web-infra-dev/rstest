import { expect, rs, test } from '@rstest/core';
import increment from 'react';

rs.mock('react', () => {
  return {
    default: (num: number) => num + 42,
  };
});

test('interop default export', async () => {
  // @ts-expect-error
  expect(increment(1)).toBe(43);
});
