/**
 * AgentProxy - Browser-side AI Agent API for @rstest/midscene
 *
 * This class provides a Midscene-like Agent API that can be used in browser tests.
 * All AI operations are forwarded to the host (Node.js) side via RPC, where the
 * actual Midscene Agent executes the AI-powered operations.
 *
 * @example
 * ```ts
 * import { agent } from '@rstest/midscene';
 *
 * test('AI-powered test', async () => {
 *   await agent.aiTap('Submit button');
 *   await agent.aiInput('Email input field', 'test@example.com');
 *   await agent.aiAssert('Form was submitted successfully');
 * });
 * ```
 */

import { sendAiRpcRequest } from './aiRpc';

/**
 * Scroll direction options
 */
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Scroll options
 */
export interface ScrollOptions {
  direction: ScrollDirection;
  distance?: number;
  scrollType?: 'once' | 'untilBottom' | 'untilTop' | 'untilRight' | 'untilLeft';
}

/**
 * Locate result from aiLocate
 */
export interface LocateResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * AgentProxy class that forwards AI operations to the host via RPC.
 */
export class AgentProxy {
  /**
   * AI-powered tap/click on an element described in natural language.
   *
   * @param locator - Natural language description of the element to tap
   * @example
   * ```ts
   * await agent.aiTap('Submit button');
   * await agent.aiTap('The blue "Add to Cart" button');
   * ```
   */
  async aiTap(locator: string): Promise<void> {
    await sendAiRpcRequest<void>('aiTap', [locator]);
  }

  /**
   * AI-powered right-click on an element described in natural language.
   *
   * @param locator - Natural language description of the element to right-click
   */
  async aiRightClick(locator: string): Promise<void> {
    await sendAiRpcRequest<void>('aiRightClick', [locator]);
  }

  /**
   * AI-powered double-click on an element described in natural language.
   *
   * @param locator - Natural language description of the element to double-click
   */
  async aiDoubleClick(locator: string): Promise<void> {
    await sendAiRpcRequest<void>('aiDoubleClick', [locator]);
  }

  /**
   * AI-powered hover over an element described in natural language.
   *
   * @param locator - Natural language description of the element to hover over
   */
  async aiHover(locator: string): Promise<void> {
    await sendAiRpcRequest<void>('aiHover', [locator]);
  }

  /**
   * AI-powered input into an element described in natural language.
   *
   * @param locator - Natural language description of the input element
   * @param value - The text value to input
   * @example
   * ```ts
   * await agent.aiInput('Email input field', 'test@example.com');
   * await agent.aiInput('Search box', 'rstest');
   * ```
   */
  async aiInput(locator: string, value: string): Promise<void> {
    await sendAiRpcRequest<void>('aiInput', [locator, value]);
  }

  /**
   * AI-powered keyboard key press.
   *
   * @param key - The key to press (e.g., 'Enter', 'Tab', 'Escape')
   */
  async aiKeyboardPress(key: string): Promise<void> {
    await sendAiRpcRequest<void>('aiKeyboardPress', [key]);
  }

  /**
   * AI-powered scroll operation.
   *
   * @param options - Scroll options including direction and distance
   */
  async aiScroll(options: ScrollOptions): Promise<void> {
    await sendAiRpcRequest<void>('aiScroll', [options]);
  }

  /**
   * Execute a complex AI action described in natural language.
   * This can chain multiple operations together.
   *
   * @param instruction - Natural language instruction describing the action
   * @example
   * ```ts
   * await agent.aiAct('Fill in the login form with email "test@example.com" and password "secret123", then click submit');
   * ```
   */
  async aiAct(instruction: string): Promise<void> {
    await sendAiRpcRequest<void>('aiAct', [instruction]);
  }

  /**
   * AI-powered query to extract information from the page.
   *
   * @param question - Natural language question about the page content
   * @returns The extracted information
   * @example
   * ```ts
   * const items = await agent.aiQuery('What items are in the shopping cart?');
   * ```
   */
  async aiQuery<T = unknown>(question: string): Promise<T> {
    return sendAiRpcRequest<T>('aiQuery', [question]);
  }

  /**
   * AI-powered assertion about the page state.
   * Throws an error if the assertion fails.
   *
   * @param assertion - Natural language assertion about the page
   * @example
   * ```ts
   * await agent.aiAssert('The form was submitted successfully');
   * await agent.aiAssert('Error message is displayed');
   * ```
   */
  async aiAssert(assertion: string): Promise<void> {
    await sendAiRpcRequest<void>('aiAssert', [assertion]);
  }

  /**
   * AI-powered wait for a condition to be met.
   *
   * @param condition - Natural language condition to wait for
   * @param options - Optional timeout configuration
   * @example
   * ```ts
   * await agent.aiWaitFor('Loading spinner disappears');
   * await agent.aiWaitFor('Results are displayed');
   * ```
   */
  async aiWaitFor(
    condition: string,
    options?: { timeout?: number },
  ): Promise<void> {
    await sendAiRpcRequest<void>('aiWaitFor', [condition, options]);
  }

  /**
   * AI-powered element location.
   * Returns the coordinates and dimensions of the located element.
   *
   * @param locator - Natural language description of the element to locate
   * @returns The element's position and dimensions
   */
  async aiLocate(locator: string): Promise<LocateResult> {
    return sendAiRpcRequest<LocateResult>('aiLocate', [locator]);
  }

  /**
   * AI-powered boolean query about the page.
   *
   * @param question - Yes/no question about the page
   * @returns Boolean answer to the question
   * @example
   * ```ts
   * const isLoggedIn = await agent.aiBoolean('Is the user logged in?');
   * const hasError = await agent.aiBoolean('Is there an error message displayed?');
   * ```
   */
  async aiBoolean(question: string): Promise<boolean> {
    return sendAiRpcRequest<boolean>('aiBoolean', [question]);
  }

  /**
   * AI-powered number extraction from the page.
   *
   * @param question - Question asking for a number from the page
   * @returns The extracted number
   * @example
   * ```ts
   * const itemCount = await agent.aiNumber('How many items are in the cart?');
   * const price = await agent.aiNumber('What is the total price?');
   * ```
   */
  async aiNumber(question: string): Promise<number> {
    return sendAiRpcRequest<number>('aiNumber', [question]);
  }

  /**
   * AI-powered string extraction from the page.
   *
   * @param question - Question asking for a string from the page
   * @returns The extracted string
   * @example
   * ```ts
   * const title = await agent.aiString('What is the page title?');
   * const errorMessage = await agent.aiString('What does the error message say?');
   * ```
   */
  async aiString(question: string): Promise<string> {
    return sendAiRpcRequest<string>('aiString', [question]);
  }
}

/**
 * Default AgentProxy instance for convenient import.
 *
 * @example
 * ```ts
 * import { agent } from '@rstest/midscene';
 *
 * test('my test', async () => {
 *   await agent.aiTap('Submit button');
 * });
 * ```
 */
export const agent: AgentProxy = new AgentProxy();
