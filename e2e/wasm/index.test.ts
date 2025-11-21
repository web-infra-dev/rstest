import { expect, test } from '@rstest/core';
import * as wasm from './src/factorial.wasm';

test('WASM factorial', async () => {
  expect(wasm._Z4facti(1)).toBe(1);
  expect(wasm._Z4facti(2)).toBe(2);
  expect(wasm._Z4facti(3)).toBe(6);
});

test('dynamic import WASM', async () => {
  const { _Z4facti: AsyncFactorial } = await import('./src/factorial.wasm');

  expect(AsyncFactorial(1)).toBe(1);
  expect(AsyncFactorial(2)).toBe(2);
  expect(AsyncFactorial(3)).toBe(6);
});
