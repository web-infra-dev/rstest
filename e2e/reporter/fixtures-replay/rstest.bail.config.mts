import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  include: ['bail.test.ts'],
  // Elides every task after the first failure, so the replay is forced to
  // agree with the live runner about what a bail-elided task reports.
  bail: 1,
  reporters: [new LifecycleRecorder()],
});
