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

export { AgentProxy, agent } from './agentProxy';
export { initAiRpc, sendAiRpcRequest } from './aiRpc';
export type {
  AiActOptions,
  AiInputOptions,
  AiKeyboardPressOptions,
  AiRpcMethod,
  AiRpcRequest,
  AiRpcResponse,
  AiWaitForOptions,
  LocateActionOptions,
  LocateResult,
  PromptImage,
  PromptInput,
  QueryOptions,
  RecordToReportOptions,
  RunYamlResult,
  ScrollDirection,
  ScrollOptions,
} from './protocol';
