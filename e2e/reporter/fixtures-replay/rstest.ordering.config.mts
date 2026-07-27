import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  // See the note in `rstest.config.mts`: every config here names its own file.
  include: ['ordering.test.ts'],
  // See the note in `rstest.config.mts`: recorder + blob on the same run.
  reporters: [new LifecycleRecorder(), 'blob'],
});
