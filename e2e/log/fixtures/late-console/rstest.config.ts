import { defineConfig } from '@rstest/core';

export default defineConfig({
  // `isolate` is driven per case by the test via `--isolate`. Run files
  // sequentially on a single worker so that, under `isolate: false`, `a.test.ts`
  // and `b.test.ts` share one process and exercise the closed-channel path.
  pool: { maxWorkers: 1 },
  // Suppress all console output. A late log that outlives its file must not only
  // avoid crashing the run, it must also stay suppressed — forwarding it after
  // teardown (or writing it to the raw stream) would bypass this filter.
  onConsoleLog: () => false,
});
