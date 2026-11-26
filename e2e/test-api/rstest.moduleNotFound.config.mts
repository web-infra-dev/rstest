import assert from 'node:assert/strict';
import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    { name: 'external' },
    { name: 'bundled', output: { bundleDependencies: true } },
    {
      name: 'bundled-webpack',
      output: { bundleDependencies: true },
      tools: {
        rspack: {
          experiments: { runtimeMode: 'webpack' },
          plugins: [
            {
              apply(compiler: Rspack.Compiler) {
                assert.equal(
                  compiler.options.experiments.runtimeMode,
                  'webpack',
                );
              },
            },
          ],
        },
      },
    },
  ],
});
