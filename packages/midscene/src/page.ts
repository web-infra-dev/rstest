/**
 * RstestWebPage - Midscene AbstractInterface implementation for rstest browser mode
 *
 * This class implements the Midscene AbstractInterface by proxying all operations
 * through RPC to the rstest host (which controls Playwright).
 */

import {
  type DeviceAction,
  defineActionTap,
  defineActionRightClick,
  defineActionDoubleClick,
  defineActionHover,
  defineActionInput,
  defineActionKeyboardPress,
  defineActionScroll,
  defineActionDragAndDrop,
  defineActionClearInput,
} from '@midscene/core/device';

/**
 * Scroll parameter type (matching Midscene's ActionScrollParam)
 */
interface ScrollParam {
  direction?: 'up' | 'down' | 'left' | 'right';
  scrollType?:
    | 'singleAction'
    | 'scrollToBottom'
    | 'scrollToTop'
    | 'scrollToRight'
    | 'scrollToLeft';
  distance?: number | null;
  locate?: { center: [number, number] };
}
import type { ViewportSize } from './protocol';
import { sendFrameRpcRequest } from './rpc';

/**
 * Size type for viewport
 */
export type Size = {
  width: number;
  height: number;
  dpr?: number;
};

/**
 * Point type for coordinates
 */
export type Point = {
  left: number;
  top: number;
};

/**
 * Mouse button type
 */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Mouse action interface matching Midscene's expectations
 */
export interface MouseAction {
  click: (
    x: number,
    y: number,
    options?: { button?: MouseButton; count?: number },
  ) => Promise<void>;
  move: (x: number, y: number) => Promise<void>;
  wheel: (deltaX: number, deltaY: number) => Promise<void>;
  drag: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => Promise<void>;
}

/**
 * Keyboard action interface matching Midscene's expectations
 */
export interface KeyboardAction {
  type: (text: string) => Promise<void>;
  press: (
    action:
      | { key: string; command?: string }
      | { key: string; command?: string }[],
  ) => Promise<void>;
}

/**
 * Element info type for clearInput
 */
export interface ElementInfo {
  center: [number, number];
}

/**
 * Helper to sleep for a given number of milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Default scroll distance in pixels
 */
const DEFAULT_SCROLL_DISTANCE = 600;

/**
 * RstestWebPage implements Midscene's AbstractInterface for rstest browser mode.
 *
 * It proxies all browser operations through RPC to the rstest host,
 * which controls the actual Playwright browser.
 */
export class RstestWebPage {
  readonly interfaceType: string = 'rstest';

  private cachedSize: Size | null = null;
  private cachedActions: DeviceAction[] | null = null;

  /**
   * Take a screenshot and return as base64 string
   */
  async screenshotBase64(): Promise<string> {
    const response = await sendFrameRpcRequest({
      method: 'screenshot',
      args: {},
    });
    if (response.error) {
      throw new Error(`Screenshot failed: ${response.error}`);
    }
    return response.result as string;
  }

  /**
   * Get viewport size
   */
  async size(): Promise<Size> {
    if (this.cachedSize) {
      return this.cachedSize;
    }

    const response = await sendFrameRpcRequest({
      method: 'getViewportSize',
      args: {},
    });
    if (response.error) {
      throw new Error(`Get viewport size failed: ${response.error}`);
    }
    const viewport = response.result as ViewportSize;
    this.cachedSize = {
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.dpr,
    };
    return this.cachedSize;
  }

  /**
   * Get available actions for this device.
   * This is the core method that tells Midscene what actions this page supports.
   */
  actionSpace(): DeviceAction[] {
    if (this.cachedActions) {
      return this.cachedActions;
    }

    this.cachedActions = this.buildActionSpace();
    return this.cachedActions;
  }

  /**
   * Build the action space for this page
   */
  private buildActionSpace(): DeviceAction[] {
    const page = this;

    return [
      // Tap action
      defineActionTap(async (param) => {
        const element = param.locate;
        if (!element) {
          throw new Error('Element not found, cannot tap');
        }
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'left',
        });
      }),

      // Right click action
      defineActionRightClick(async (param) => {
        const element = param.locate;
        if (!element) {
          throw new Error('Element not found, cannot right click');
        }
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'right',
        });
      }),

      // Double click action
      defineActionDoubleClick(async (param) => {
        const element = param.locate;
        if (!element) {
          throw new Error('Element not found, cannot double click');
        }
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'left',
          count: 2,
        });
      }),

      // Hover action
      defineActionHover(async (param) => {
        const element = param.locate;
        if (!element) {
          throw new Error('Element not found, cannot hover');
        }
        await page.mouse.move(element.center[0], element.center[1]);
      }),

      // Input action
      defineActionInput(async (param) => {
        const element = param.locate;
        if (element && param.mode !== 'append') {
          await page.clearInput(element as unknown as ElementInfo);
        }

        if (param.mode === 'clear') {
          // Clear mode removes existing text without entering new characters
          return;
        }

        if (!param || !param.value) {
          return;
        }

        await page.keyboard.type(param.value);
      }),

      // Keyboard press action
      defineActionKeyboardPress(async (param) => {
        const element = param.locate;
        if (element) {
          await page.mouse.click(element.center[0], element.center[1], {
            button: 'left',
          });
        }

        // Parse key combinations (e.g., "Control+A" -> [{key: "Control"}, {key: "a"}])
        const keys = param.keyName.split('+').map((k) => ({ key: k.trim() }));
        await page.keyboard.press(keys);
      }),

      // Scroll action
      defineActionScroll(async (param: ScrollParam) => {
        const element = param.locate;
        const startingPoint = element
          ? { left: element.center[0], top: element.center[1] }
          : undefined;

        const scrollToEventName = param?.scrollType;
        if (scrollToEventName === 'scrollToTop') {
          await page.scrollUntilTop(startingPoint);
        } else if (scrollToEventName === 'scrollToBottom') {
          await page.scrollUntilBottom(startingPoint);
        } else if (scrollToEventName === 'scrollToRight') {
          await page.scrollUntilRight(startingPoint);
        } else if (scrollToEventName === 'scrollToLeft') {
          await page.scrollUntilLeft(startingPoint);
        } else if (scrollToEventName === 'singleAction' || !scrollToEventName) {
          if (param?.direction === 'down' || !param || !param.direction) {
            await page.scrollDown(param?.distance || undefined, startingPoint);
          } else if (param.direction === 'up') {
            await page.scrollUp(param.distance || undefined, startingPoint);
          } else if (param.direction === 'left') {
            await page.scrollLeft(param.distance || undefined, startingPoint);
          } else if (param.direction === 'right') {
            await page.scrollRight(param.distance || undefined, startingPoint);
          } else {
            throw new Error(`Unknown scroll direction: ${param.direction}`);
          }
          // Wait for scroll to complete
          await sleep(500);
        } else {
          throw new Error(`Unknown scroll event type: ${scrollToEventName}`);
        }
      }),

      // Drag and drop action
      defineActionDragAndDrop(async (param) => {
        const from = param.from;
        const to = param.to;
        if (!from || !to) {
          throw new Error('From or to element not found, cannot drag and drop');
        }
        await page.mouse.drag(
          { x: from.center[0], y: from.center[1] },
          { x: to.center[0], y: to.center[1] },
        );
      }),

      // Clear input action
      defineActionClearInput(async (param) => {
        const element = param.locate;
        if (!element) {
          throw new Error('Element not found, cannot clear input');
        }
        await page.clearInput(element as unknown as ElementInfo);
      }),
    ];
  }

  /**
   * Get current page URL
   */
  async url(): Promise<string> {
    const response = await sendFrameRpcRequest({
      method: 'getUrl',
      args: {},
    });
    if (response.error) {
      throw new Error(`Get URL failed: ${response.error}`);
    }
    return response.result as string;
  }

  /**
   * Describe the current page (returns URL)
   */
  describe(): string {
    // Synchronous version - returns empty string if URL not cached
    // This is acceptable as it's mainly for debugging
    return '';
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluateJavaScript<T = unknown>(script: string): Promise<T> {
    const response = await sendFrameRpcRequest({
      method: 'evaluate',
      args: { expression: script },
    });
    if (response.error) {
      throw new Error(`Evaluate failed: ${response.error}`);
    }
    return response.result as T;
  }

  /**
   * Mouse operations proxy
   */
  get mouse(): MouseAction {
    return {
      click: async (
        x: number,
        y: number,
        options?: { button?: MouseButton; count?: number },
      ): Promise<void> => {
        const { button = 'left', count = 1 } = options || {};

        // Handle double click
        if (count === 2) {
          const response = await sendFrameRpcRequest({
            method: 'mouse.dblclick',
            args: { x, y, options: { button } },
          });
          if (response.error) {
            throw new Error(`Mouse double click failed: ${response.error}`);
          }
          return;
        }

        // Regular click
        const response = await sendFrameRpcRequest({
          method: 'mouse.click',
          args: { x, y, options: { button, clickCount: count } },
        });
        if (response.error) {
          throw new Error(`Mouse click failed: ${response.error}`);
        }
      },

      move: async (x: number, y: number): Promise<void> => {
        const response = await sendFrameRpcRequest({
          method: 'mouse.move',
          args: { x, y },
        });
        if (response.error) {
          throw new Error(`Mouse move failed: ${response.error}`);
        }
      },

      wheel: async (deltaX: number, deltaY: number): Promise<void> => {
        const response = await sendFrameRpcRequest({
          method: 'mouse.wheel',
          args: { deltaX, deltaY },
        });
        if (response.error) {
          throw new Error(`Mouse wheel failed: ${response.error}`);
        }
      },

      drag: async (
        from: { x: number; y: number },
        to: { x: number; y: number },
      ): Promise<void> => {
        // Implement drag as: move to start -> mouse down -> move to end -> mouse up
        await this.mouse.move(from.x, from.y);

        let response = await sendFrameRpcRequest({
          method: 'mouse.down',
          args: { button: 'left' },
        });
        if (response.error) {
          throw new Error(`Mouse down failed: ${response.error}`);
        }

        await this.mouse.move(to.x, to.y);

        response = await sendFrameRpcRequest({
          method: 'mouse.up',
          args: { button: 'left' },
        });
        if (response.error) {
          throw new Error(`Mouse up failed: ${response.error}`);
        }
      },
    };
  }

  /**
   * Keyboard operations proxy
   */
  get keyboard(): KeyboardAction {
    return {
      type: async (text: string): Promise<void> => {
        const response = await sendFrameRpcRequest({
          method: 'keyboard.type',
          args: { text, delay: 50 },
        });
        if (response.error) {
          throw new Error(`Keyboard type failed: ${response.error}`);
        }
      },

      press: async (
        action:
          | { key: string; command?: string }
          | { key: string; command?: string }[],
      ): Promise<void> => {
        const keys = Array.isArray(action) ? action : [action];

        // Press all keys down
        for (const k of keys) {
          const response = await sendFrameRpcRequest({
            method: 'keyboard.down',
            args: { key: k.key },
          });
          if (response.error) {
            throw new Error(`Keyboard down failed: ${response.error}`);
          }
        }

        // Release all keys in reverse order
        for (const k of [...keys].reverse()) {
          const response = await sendFrameRpcRequest({
            method: 'keyboard.up',
            args: { key: k.key },
          });
          if (response.error) {
            throw new Error(`Keyboard up failed: ${response.error}`);
          }
        }
      },
    };
  }

  /**
   * Clear input field - clicks element and selects all then deletes
   */
  async clearInput(element: ElementInfo): Promise<void> {
    if (!element) {
      console.warn('No element to clear input');
      return;
    }

    // Click the element
    await this.mouse.click(element.center[0], element.center[1]);

    // Select all (Ctrl+A / Cmd+A)
    // In browser context, we can check userAgent for platform detection
    const isMac =
      typeof navigator !== 'undefined' &&
      /mac/i.test(navigator.userAgent || '');
    const modifier = isMac ? 'Meta' : 'Control';

    await this.keyboard.press([{ key: modifier }, { key: 'a' }]);

    // Delete
    await this.keyboard.press([{ key: 'Backspace' }]);
  }

  // Scroll methods for actionSpace
  async scrollDown(distance?: number, startingPoint?: Point): Promise<void> {
    const scrollDistance = distance || DEFAULT_SCROLL_DISTANCE;
    await this.performScroll(0, scrollDistance, startingPoint);
  }

  async scrollUp(distance?: number, startingPoint?: Point): Promise<void> {
    const scrollDistance = distance || DEFAULT_SCROLL_DISTANCE;
    await this.performScroll(0, -scrollDistance, startingPoint);
  }

  async scrollLeft(distance?: number, startingPoint?: Point): Promise<void> {
    const scrollDistance = distance || DEFAULT_SCROLL_DISTANCE;
    await this.performScroll(-scrollDistance, 0, startingPoint);
  }

  async scrollRight(distance?: number, startingPoint?: Point): Promise<void> {
    const scrollDistance = distance || DEFAULT_SCROLL_DISTANCE;
    await this.performScroll(scrollDistance, 0, startingPoint);
  }

  async scrollUntilTop(startingPoint?: Point): Promise<void> {
    // Scroll up repeatedly until we can't scroll anymore
    let previousScrollY = -1;
    for (let i = 0; i < 50; i++) {
      // Max 50 iterations
      await this.scrollUp(DEFAULT_SCROLL_DISTANCE, startingPoint);
      await sleep(100);

      const scrollY = await this.evaluateJavaScript<number>('window.scrollY');
      if (scrollY === previousScrollY || scrollY === 0) {
        break;
      }
      previousScrollY = scrollY;
    }
  }

  async scrollUntilBottom(startingPoint?: Point): Promise<void> {
    // Scroll down repeatedly until we can't scroll anymore
    let previousScrollY = -1;
    for (let i = 0; i < 50; i++) {
      // Max 50 iterations
      await this.scrollDown(DEFAULT_SCROLL_DISTANCE, startingPoint);
      await sleep(100);

      const scrollY = await this.evaluateJavaScript<number>('window.scrollY');
      if (scrollY === previousScrollY) {
        break;
      }
      previousScrollY = scrollY;
    }
  }

  async scrollUntilLeft(startingPoint?: Point): Promise<void> {
    // Scroll left repeatedly until we can't scroll anymore
    let previousScrollX = -1;
    for (let i = 0; i < 50; i++) {
      // Max 50 iterations
      await this.scrollLeft(DEFAULT_SCROLL_DISTANCE, startingPoint);
      await sleep(100);

      const scrollX = await this.evaluateJavaScript<number>('window.scrollX');
      if (scrollX === previousScrollX || scrollX === 0) {
        break;
      }
      previousScrollX = scrollX;
    }
  }

  async scrollUntilRight(startingPoint?: Point): Promise<void> {
    // Scroll right repeatedly until we can't scroll anymore
    let previousScrollX = -1;
    for (let i = 0; i < 50; i++) {
      // Max 50 iterations
      await this.scrollRight(DEFAULT_SCROLL_DISTANCE, startingPoint);
      await sleep(100);

      const scrollX = await this.evaluateJavaScript<number>('window.scrollX');
      if (scrollX === previousScrollX) {
        break;
      }
      previousScrollX = scrollX;
    }
  }

  private async performScroll(
    deltaX: number,
    deltaY: number,
    startingPoint?: Point,
  ): Promise<void> {
    // If a starting point is provided, move to it first
    if (startingPoint) {
      await this.mouse.move(startingPoint.left, startingPoint.top);
    }
    await this.mouse.wheel(deltaX, deltaY);
  }

  // Optional methods that can be implemented later
  async destroy(): Promise<void> {
    // No-op for rstest
  }

  async beforeInvokeAction(_name: string, _param: unknown): Promise<void> {
    // No-op
  }

  async afterInvokeAction(_name: string, _param: unknown): Promise<void> {
    // No-op
  }
}

/**
 * Singleton instance for convenient usage
 */
export const rstestPage: RstestWebPage = new RstestWebPage();
