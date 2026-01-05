import { beforeEach } from '@rstest/core';
import { act, cleanup, render, renderHook } from './pure';

// Auto-cleanup before each test
// (before, not after, so we can inspect the DOM after a test failure)
beforeEach(async () => {
  await cleanup();
});

export { render, renderHook, cleanup, act };
export type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from './pure';
