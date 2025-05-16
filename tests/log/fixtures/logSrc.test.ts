import { expect, test } from '@rstest/core';

test('src log output', async () => {
  await import('./src/index');
  expect(1).toBe(1);
});
