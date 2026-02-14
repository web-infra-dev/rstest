import { defineConfig } from '@rstest/core';

// `pnpm test` at the repo root discovers projects via `examples/*`.
// Treat `examples/federation` as an umbrella project that delegates to the
// real test projects which carry the federation + React build setup.
export default defineConfig({
  projects: ['./main-app', './component-app'],
});
