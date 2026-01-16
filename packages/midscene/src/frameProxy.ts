/**
 * FrameProxy - Browser-side proxy for Playwright Frame API
 *
 * This class provides a Playwright-like API that sends RPC requests to
 * the host to control the actual Playwright frame operations.
 */

import type { FrameMouseClickOptions } from './protocol';
import { sendFrameRpcRequest } from './rpc';

/**
 * Keyboard proxy for typing and pressing keys
 */
export class KeyboardProxy {
  /**
   * Type text into the focused element
   * @param text - Text to type
   * @param delay - Optional delay between key presses in milliseconds
   */
  async type(text: string, delay?: number): Promise<void> {
    const response = await sendFrameRpcRequest({
      method: 'keyboard.type',
      args: { text, delay },
    });
    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Press a key (e.g., 'Enter', 'Tab', 'Escape', 'Control+A')
   * @param key - Key to press
   * @param delay - Optional delay in milliseconds
   */
  async press(key: string, delay?: number): Promise<void> {
    const response = await sendFrameRpcRequest({
      method: 'keyboard.press',
      args: { key, delay },
    });
    if (response.error) {
      throw new Error(response.error);
    }
  }
}

/**
 * Mouse proxy for clicking at coordinates
 */
export class MouseProxy {
  /**
   * Click at the specified coordinates (relative to iframe)
   * @param x - X coordinate relative to iframe
   * @param y - Y coordinate relative to iframe
   * @param options - Optional click options
   */
  async click(
    x: number,
    y: number,
    options?: FrameMouseClickOptions,
  ): Promise<void> {
    const response = await sendFrameRpcRequest({
      method: 'mouse.click',
      args: { x, y, options },
    });
    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Move mouse to the specified coordinates (relative to iframe)
   * @param x - X coordinate relative to iframe
   * @param y - Y coordinate relative to iframe
   */
  async move(x: number, y: number): Promise<void> {
    const response = await sendFrameRpcRequest({
      method: 'mouse.move',
      args: { x, y },
    });
    if (response.error) {
      throw new Error(response.error);
    }
  }
}

/**
 * FrameProxy provides a Playwright-like API for controlling the browser frame
 * from within the test runner iframe.
 *
 * @example
 * ```ts
 * import { frame } from '@rstest/midscene';
 *
 * // Click an element by selector
 * await frame.click('button#submit');
 *
 * // Type text
 * await frame.keyboard.type('Hello, world!');
 *
 * // Press keys
 * await frame.keyboard.press('Enter');
 *
 * // Click at coordinates
 * await frame.mouse.click(100, 200);
 *
 * // Take screenshot
 * const screenshot = await frame.screenshot();
 * ```
 */
export class FrameProxy {
  /** Keyboard operations */
  readonly keyboard: KeyboardProxy = new KeyboardProxy();

  /** Mouse operations */
  readonly mouse: MouseProxy = new MouseProxy();

  /**
   * Click an element by selector
   * @param selector - CSS selector
   * @param options - Optional click options
   */
  async click(
    selector: string,
    options?: FrameMouseClickOptions,
  ): Promise<void> {
    const response = await sendFrameRpcRequest({
      method: 'click',
      args: { selector, options },
    });
    if (response.error) {
      throw new Error(response.error);
    }
  }

  /**
   * Take a screenshot of the iframe
   * @param options - Optional screenshot options
   * @returns Base64 encoded screenshot data
   */
  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    const response = await sendFrameRpcRequest({
      method: 'screenshot',
      args: options ?? {},
    });
    if (response.error) {
      throw new Error(response.error);
    }
    return response.result as string;
  }

  /**
   * Evaluate JavaScript in the frame context
   * @param expression - JavaScript expression to evaluate
   * @returns The result of the evaluation
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const response = await sendFrameRpcRequest({
      method: 'evaluate',
      args: { expression },
    });
    if (response.error) {
      throw new Error(response.error);
    }
    return response.result as T;
  }
}

/**
 * Singleton FrameProxy instance for convenient usage
 */
export const frame: FrameProxy = new FrameProxy();
