// Stands in for a wasm-bindgen `--target bundler` foo_bg.js: it imports the
// wasm namespace (circular with the wasm), and exports the function the wasm
// imports as a hoisted declaration so it is bound at link time.
import * as wasm from './mod.wasm';

// Module-level state makes glue identity observable: the wasm imports `imp`
// from THIS module, so a call routed through the wasm bumps this counter only
// if the wasm linked against the SAME glue instance the test holds. With the
// build-time wasmLoader, glue stays in rspack's module graph → single shared
// instance. A native auto-link approach would link the wasm against a separate
// Node-loaded glue copy and this counter would never move (split-brain).
let impCalls = 0;
export function imp() {
  impCalls += 1;
  return 42;
}
export function getImpCalls() {
  return impCalls;
}
export function callExp() {
  return wasm.exp();
}
