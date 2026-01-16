/**
 * @rstest/midscene - Midscene integration for Rstest browser mode
 *
 * This is the primary public entry point. It provides:
 * - the browser-side Agent API for intelligent test automation
 * - the `withMidscene` config helper for `rstest.config.ts`
 *
 * @example
 * ```ts
 * import { test } from '@rstest/core';
 * import { agent } from '@rstest/midscene';
 *
 * // AI-powered API (by natural language)
 * test('AI test', async () => {
 *   await agent.aiTap('Submit button');
 *   await agent.aiInput('Email field', 'test@example.com');
 *   await agent.aiAssert('Form was submitted successfully');
 * });
 * ```
 *
 * @packageDocumentation
 */

export { agent } from './agentProxy';
export { withMidscene } from './config';
export type {
  MidsceneAgentOptions,
  MidsceneDispatchContext,
  MidsceneProfileMap,
  MidsceneProfileResolver,
  PluginMidsceneOptions,
} from './pluginTypes';
