import { defineConfig } from '@rstest/core';

export default defineConfig({
  federation: true,
  globalSetup: ['./setup.ts'],
  // Emitted assets are only reachable through the real filesystem: federation
  // no longer installs a virtual `fs` view over the in-memory build output
  // (chunks load through `require`), so tests that read emitted files opt
  // into writing the build output to disk.
  dev: {
    writeToDisk: true,
  },
  output: {
    emitAssets: true,
  },
});
