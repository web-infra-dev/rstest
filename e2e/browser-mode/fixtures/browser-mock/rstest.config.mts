import assert from 'node:assert/strict';
import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Exercises the whole rs.mock family inside browser test files (the browser
// client build registers the same mock transform pipeline as the node build).
export default defineConfig({
  tools: {
    rspack: {
      plugins: [
        {
          apply(compiler: Rspack.Compiler) {
            assert.equal(compiler.options.experiments.runtimeMode, 'rspack');
          },
        },
      ],
    },
  },
  resolve: {
    alias: {
      'virtual-browser-module': false,
    },
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-mock'],
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./rstest.setup.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
