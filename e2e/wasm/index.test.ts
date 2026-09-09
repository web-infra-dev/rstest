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

test('relative dynamic import WASM', async () => {
  // Non-literal *relative* specifier from this bundled test entry. `['wa','sm']`
  // defeats constant folding so it reaches the runtime import hook, where it
  // must resolve against the source origin (not the dist chunk dir) and route
  // through `loadWasm` — otherwise it falls back to a native `.wasm` import that
  // throws ERR_UNKNOWN_FILE_EXTENSION on Node without `--experimental-wasm-modules`.
  const ext = ['wa', 'sm'].join('');
  const ns = await import(`./src/factorial.${ext}`);

  expect(ns._Z4facti(3)).toBe(6);
});

test('url load WASM', async () => {
  const { loadWASM } = await import('./src/factorial.ts');
  const ns = await loadWASM();

  expect(ns._Z4facti(1)).toBe(1);
  expect(ns._Z4facti(2)).toBe(2);
  expect(ns._Z4facti(3)).toBe(6);

  // Parity with Node's WebAssembly ESM namespace: wasm exports are exposed as
  // named exports with no synthetic `default` (`'default' in ns === false`).
  expect('default' in ns).toBe(false);
});
