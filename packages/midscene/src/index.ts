/**
 * @rstest/midscene - Midscene integration for Rstest browser mode
 *
 * This is the browser-side entry point. It provides:
 * 1. Playwright-like API for controlling the browser (frame, keyboard, mouse)
 * 2. AI-powered Agent API for intelligent test automation (agent.aiTap, agent.aiInput, etc.)
 *
 * @example
 * ```ts
 * import { test } from '@rstest/core';
 * import { frame, agent } from '@rstest/midscene';
 *
 * // Playwright-like API (by CSS selectors)
 * test('click a button', async () => {
 *   await frame.click('button#submit');
 *   await frame.keyboard.type('Hello, world!');
 * });
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

// Export fixture types
export type { MidsceneFixtures } from './fixture';

// Export FrameProxy and related classes
export { FrameProxy, frame, KeyboardProxy, MouseProxy } from './frameProxy';

// Export AgentProxy for AI-powered testing
export {
  AgentProxy,
  agent,
  type ScrollDirection,
  type ScrollOptions,
  type LocateResult,
} from './agentProxy';

// Export types
export type {
  FrameMouseClickOptions,
  FrameRpcRequest,
  FrameRpcResponse,
  ViewportSize,
  AiRpcMethod,
  AiRpcRequest,
  AiRpcResponse,
} from './protocol';

// Export RPC utilities for advanced usage
export { initFrameRpc, sendFrameRpcRequest } from './rpc';
export { initAiRpc, sendAiRpcRequest } from './aiRpc';
