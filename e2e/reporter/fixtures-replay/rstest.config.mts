import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  // Each fixture in this directory is recorded on its own, so every config
  // here must name its file: the sibling `bail.test.ts` fails by design, and
  // the sequence assertions break the moment two fixtures share a run.
  include: ['lifecycle.test.ts'],
  reporters: [new LifecycleRecorder()],
});
