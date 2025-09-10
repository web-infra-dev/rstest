import { expect, rs, test } from '@rstest/core';
// @ts-expect-error: "react" has been mocked.
import increment from 'react';

rs.mock('react', () => {
  return {
    default: (num: number) => num + 42,
  };
});

test('interop default export', async () => {
  expect(increment(1)).toBe(43);
});
