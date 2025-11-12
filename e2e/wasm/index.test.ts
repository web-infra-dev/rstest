import { expect, test } from '@rstest/core';

test('WASM factorial', async () => {
  const { _Z4facti: AsyncFactorial } = await import('./src/factorial.wasm');

  expect(AsyncFactorial(1)).toBe(1);
  expect(AsyncFactorial(2)).toBe(2);
  expect(AsyncFactorial(3)).toBe(6);
});
