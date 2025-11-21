import { expect, test } from '@rstest/core';

// TODO: need to fix below error after bump rspack 1.6.2+
// WebAssemb ly.instantiate（）： length overflow while decoding section length @+13
test.fails('WASM factorial', async () => {
  const { _Z4facti: AsyncFactorial } = await import('./src/factorial.wasm');

  expect(AsyncFactorial(1)).toBe(1);
  expect(AsyncFactorial(2)).toBe(2);
  expect(AsyncFactorial(3)).toBe(6);
});
