import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  // See the notes in `rstest.config.mts`: one file per config, recorder + blob
  // on the same run.
  include: ['empty.test.ts'],
  reporters: [new LifecycleRecorder(), 'blob'],
});
