/**
 * @rstest/midscene/agent - Node-side Midscene Agent for rstest browser mode
 *
 * This is the Node-side entry point that provides AI-powered testing capabilities.
 * Import this in Node.js context (not in browser tests).
 *
 * @example
 * ```ts
 * import { RstestAgent } from '@rstest/midscene/agent';
 *
 * // Use in a Node.js script or test setup
 * const agent = new RstestAgent();
 * await agent.aiTap('Submit button');
 * await agent.aiInput('Email input', 'test@example.com');
 * await agent.aiAssert('Success message is displayed');
 * ```
 *
 * @packageDocumentation
 */

import { Agent, type AgentOpt } from '@midscene/core';
import { RstestWebPage } from './page';

/**
 * Options for RstestAgent
 */
export interface RstestAgentOpt extends AgentOpt {
  // Additional rstest-specific options can be added here
}

/**
 * RstestAgent extends Midscene's Agent to provide AI-powered testing capabilities
 * for rstest browser mode.
 *
 * It automatically creates an RstestWebPage instance that communicates with the
 * rstest host through RPC.
 */
export class RstestAgent extends Agent<RstestWebPage> {
  /**
   * Create a new RstestAgent
   *
   * @param opts - Optional agent configuration
   */
  constructor(opts?: RstestAgentOpt) {
    const webPage = new RstestWebPage();
    super(webPage, opts);
  }
}

/**
 * Create a new RstestAgent with the given options
 *
 * @param opts - Optional agent configuration
 * @returns A new RstestAgent instance
 */
export function createRstestAgent(opts?: RstestAgentOpt): RstestAgent {
  return new RstestAgent(opts);
}

// Re-export RstestWebPage and related types
export {
  RstestWebPage,
  rstestPage,
  type MouseAction,
  type KeyboardAction,
  type MouseButton,
  type Size,
  type Point,
  type ElementInfo,
} from './page';

// Re-export useful types from @midscene/core
export { type AgentOpt } from '@midscene/core';
