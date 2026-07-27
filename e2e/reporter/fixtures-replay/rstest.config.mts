import { defineConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

export default defineConfig({
  // Each fixture in this directory is recorded on its own, so every config
  // here must name its file: the sibling `bail.test.ts` fails by design, and
  // the sequence assertions break the moment two fixtures share a run.
  include: ['lifecycle.test.ts'],
  // The recorder and the blob must observe one and the same run — see the note
  // on `captureReplay` in `../mergeReports.test.ts`.
  reporters: [new LifecycleRecorder(), 'blob'],
});
