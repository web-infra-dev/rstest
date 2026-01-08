import { beforeEach } from '@rstest/core';
import { act, cleanup, configure, render, renderHook } from './pure';

// Auto-cleanup before each test
// (before, not after, so we can inspect the DOM after a test failure)
beforeEach(async () => {
  await cleanup();
});

export { render, renderHook, cleanup, act, configure };
export type {
  RenderConfiguration,
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from './pure';
