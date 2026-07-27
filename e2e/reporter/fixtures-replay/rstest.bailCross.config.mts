import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  // See the notes in `rstest.config.mts`: recorder + blob on the same run.
  // Two files on one worker: `bailFirst` fails, so the worker's cross-file
  // bail check skips `bailSecond` before `onTestFileStart` ever fires — the
  // skipped file reports a result with no file window.
  include: ['bailFirst.test.ts', 'bailSecond.test.ts'],
  bail: 1,
  pool: { maxWorkers: 1 },
  reporters: [new LifecycleRecorder(), 'blob'],
});
