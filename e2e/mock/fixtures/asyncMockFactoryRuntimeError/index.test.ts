import { expect, rs, test } from '@rstest/core';

// @ts-expect-error async mock factories are not supported
rs.mock(import('../../src/increment'), async () => ({
  increment: (num: number) => num + 100,
}));

test('async mock factory should fail loud', async () => {
  const { increment } = await import('../../src/increment');
  expect(increment(1)).toBe(101);
});
