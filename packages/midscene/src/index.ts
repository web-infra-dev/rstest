/**
 * @rstest/midscene - Midscene integration for Rstest browser mode
 *
 * This is the browser-side entry point. It provides:
 * AI-powered Agent API for intelligent test automation
 * (agent.aiTap, agent.aiInput, agent.aiAct, etc.)
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

// Export AgentProxy for AI-powered testing
export {
  AgentProxy,
  agent,
  type LocateResult,
  type ScrollDirection,
  type ScrollOptions,
} from './agentProxy';
// Export RPC utilities for advanced usage
export { initAiRpc, sendAiRpcRequest } from './aiRpc';
// Export types
export type { AiRpcMethod, AiRpcRequest, AiRpcResponse } from './protocol';
