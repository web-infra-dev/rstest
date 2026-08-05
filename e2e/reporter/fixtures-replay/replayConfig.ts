import { defineConfig, type RstestConfig } from '@rstest/core';
import { LifecycleRecorder } from './lifecycleRecorder';

/**
 * Shared base for every fixture config in this directory. Each fixture is
 * recorded on its own, so every config must name its own file(s): the sibling
 * `bail.test.ts` fails by design, and the sequence assertions break the moment
 * two fixtures share a run. The recorder and the blob reporter must observe
 * one and the same run — see the note on `captureReplay` in
 * `../mergeReports.test.ts`.
 */
export const replayConfig = (overrides: RstestConfig): RstestConfig =>
  defineConfig({
    reporters: [new LifecycleRecorder(), 'blob'],
    ...overrides,
  });
