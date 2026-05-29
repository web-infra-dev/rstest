import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      format: 'esm',
      syntax: 'es2023',
      dts: true,
      redirect: {
        // Append `.js` to relative imports in emitted .d.ts so they resolve
        // under NodeNext/Node16 module resolution (ESM requires explicit ext).
        dts: { extension: true },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
    {
      // Off-main-thread coverage merge worker (issue #1326). Built as a
      // standalone, self-contained entry so the host can spawn it by absolute
      // path via `worker_threads`. Not a public export — referenced internally
      // through `CoverageProvider.coverageMergeWorker`.
      format: 'esm',
      syntax: 'es2023',
      dts: false,
      source: {
        entry: { coverageMergeWorker: './src/coverageMergeWorker.ts' },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
