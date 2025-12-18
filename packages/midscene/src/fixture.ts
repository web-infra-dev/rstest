/**
 * Test fixtures for @rstest/midscene
 *
 * Provides test fixtures for using the FrameProxy in tests.
 *
 * @example
 * ```ts
 * import { test as baseTest } from '@rstest/core';
 * import { frame, type MidsceneFixtures } from '@rstest/midscene';
 *
 * const test = baseTest.extend<MidsceneFixtures>({
 *   frame: async ({}, use) => {
 *     await use(frame);
 *   },
 * });
 *
 * test('click a button', async ({ frame }) => {
 *   await frame.click('button#submit');
 * });
 * ```
 *
 * Or use the singleton directly:
 *
 * ```ts
 * import { test } from '@rstest/core';
 * import { frame } from '@rstest/midscene';
 *
 * test('click a button', async () => {
 *   await frame.click('button#submit');
 * });
 * ```
 */

import type { FrameProxy } from './frameProxy';

/**
 * Extended test fixtures for @rstest/midscene
 */
export interface MidsceneFixtures {
  /**
   * FrameProxy instance for controlling the browser frame.
   * Provides Playwright-like API for clicking, typing, screenshots, etc.
   */
  frame: FrameProxy;
}
