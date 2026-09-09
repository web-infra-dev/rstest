import { expect, test } from '@rstest/core';
import { callExp, getImpCalls } from './src/glue.js';

// Import-bearing wasm (the wasm declares `(import "<module>" "imp" ...)`):
// - mod.wasm imports a RESOLVABLE JS module ('./glue.js') — the wasm-bindgen
//   `--target bundler` shape, including the circular glue<->wasm dependency.
//   wasmLoader.mjs links the glue statically and instantiates with an
//   importObject, so a plain `import` works transparently.
// - envmod.wasm imports the synthetic, non-resolvable 'env' module: the build
//   must still succeed (no `import 'env'` emitted) and only fail at runtime.

test('resolvable glue import: circular wasm-bindgen-bundler shape links transparently', () => {
  expect(callExp()).toBe(42); // glue.callExp -> wasm.exp -> imports ./glue.js imp() -> 42
});

test('direct import of an import-bearing wasm resolves its importObject', async () => {
  const ns = await import('./src/mod.wasm');
  expect(ns.exp()).toBe(42);
});

test('non-resolvable env import builds, and only LinkErrors at runtime', async () => {
  await expect(import('./src/envmod.wasm')).rejects.toThrow();
});

// The wasm loader wires an import-module by actually resolving it, not by
// checking for a `./ ../ /` prefix. aliasmod.wasm imports `@e2e/wasm-glue`
// (a non-relative specifier mapped via resolve.alias); a prefix-only heuristic
// would drop it and the wasm would LinkError. Actual resolution wires the glue.
test('alias import module: non-relative specifier resolves its glue via resolve.alias', async () => {
  const ns = await import('./src/aliasmod.wasm');
  expect(ns.exp()).toBe(42); // wasm.exp -> imports @e2e/wasm-glue imp() -> 42
});

// Regression guard for the load-bearing property that distinguishes the
// build-time wasmLoader from any native auto-link approach: the glue the test
// imports and the glue the wasm links against must be the SAME instance. The
// loader keeps glue in rspack's module graph (one shared instance), so a state
// mutation the wasm triggers through `imp()` is observable here. A native
// `import('x.wasm')` would link the wasm against a separate Node-loaded glue
// copy, leaving `getImpCalls()` at its prior value (split-brain).
test('import-bearing wasm links the same glue instance the test holds (no split-brain)', () => {
  const before = getImpCalls();
  callExp(); // -> wasm.exp() -> calls glue.imp() exactly once
  expect(getImpCalls()).toBe(before + 1);
});
