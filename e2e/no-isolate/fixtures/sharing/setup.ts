import { beforeAll } from '@rstest/core';

// Setup must re-run per file under `isolate: false`: each run records its own
// file, so a stale value would mean setup stopped re-running.
beforeAll((ctx) => {
  (globalThis as Record<string, any>).__rstestSetupFor = ctx.filepath;
});
