import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: true,
    },
    {
      // Off-main-thread coverage merge worker (issue #1326). Built as a
      // standalone, self-contained entry so the host can spawn it by absolute
      // path via `worker_threads`. Not a public export — referenced internally
      // through `CoverageProvider.coverageMergeWorker`.
      format: 'esm',
      syntax: 'es2021',
      dts: false,
      source: {
        entry: { coverageMergeWorker: './src/coverageMergeWorker.ts' },
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
