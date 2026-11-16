import assert from 'node:assert/strict';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

const externals = [
  { 'shared-user-external': 'commonjs node:path' },
  (_data, callback) => callback(),
] satisfies Rspack.ExternalItem[];
const original = [...externals];
if (process.env.FREEZE_EXTERNALS === 'true') Object.freeze(externals);

export default defineConfig({
  root: import.meta.dirname,
  projects: (['jsdom', 'happy-dom', 'node'] as const).map((name) => ({
    name,
    include: ['./sharedExternals.test.ts'],
    testEnvironment: name,
    output: { bundleDependencies: true },
    source: { define: { EXPECTED_ENVIRONMENT: JSON.stringify(name) } },
    tools: {
      rspack(config: Rspack.Configuration) {
        config.externals = externals;
      },
    },
    plugins: [
      {
        name: 'assert-user-externals',
        setup(api) {
          api.onAfterCreateCompiler(() => {
            assert.deepEqual(externals, original);
          });
        },
      } satisfies RsbuildPlugin,
    ],
  })),
});
