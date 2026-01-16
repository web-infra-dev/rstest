/**
 * HostWebPage - Midscene AbstractWebPage implementation for rstest host-side
 *
 * This class extends Midscene's AbstractWebPage by using Playwright's Page and Frame
 * objects to control the browser iframe. It provides the interface that Midscene's
 * Agent needs to perform AI-driven operations.
 */

import type { ElementHandle, Frame, Page } from 'playwright';

/**
 * Point type from Midscene (simplified)
 */
type Point = {
  left: number;
  top: number;
};

/**
 * ElementInfo type for clearInput (simplified from Midscene)
 * Only the center coordinates are needed for our purposes
 */
interface ElementInfo {
  center: [number, number];
}

/**
 * Size type for viewport
 */
type Size = {
  width: number;
  height: number;
  dpr?: number;
};

/**
 * Mouse button type
 */
type MouseButton = 'left' | 'right' | 'middle';

/**
 * KeyInput type (simplified from Playwright)
 */
type KeyInput = string;

/**
 * LocateResultElement - simplified type for action parameters
 */
interface LocateResultElement {
  center: [number, number];
}

/**
 * ActionScrollParam - simplified type for scroll action
 * Note: scrollType uses string to be compatible with all @midscene/core versions
 */
interface ActionScrollParam {
  direction?: 'up' | 'down' | 'left' | 'right';
  scrollType?: string;
  distance?: number | null;
  locate?: LocateResultElement;
}

/**
 * MouseAction interface matching AbstractWebPage
 */
interface MouseAction {
  click: (
    x: number,
    y: number,
    options?: { button?: MouseButton; count?: number },
  ) => Promise<void>;
  wheel: (deltaX: number, deltaY: number) => Promise<void>;
  move: (x: number, y: number) => Promise<void>;
  drag: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => Promise<void>;
}

/**
 * KeyboardAction interface matching AbstractWebPage
 */
interface KeyboardAction {
  type: (text: string) => Promise<void>;
  press: (
    action:
      | { key: KeyInput; command?: string }
      | { key: KeyInput; command?: string }[],
  ) => Promise<void>;
}

/**
 * Sleep helper function
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize key inputs - handles "Ctrl+A" style strings
 */
function normalizeKeyInputs(value: string | string[]): string[] {
  const inputs = Array.isArray(value) ? value : [value];
  const result: string[] = [];

  for (const input of inputs) {
    if (typeof input !== 'string') {
      result.push(input as unknown as string);
      continue;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      result.push(input);
      continue;
    }

    let normalized = trimmed;
    // Handle "Ctrl+A" style input - replace + with space
    if (normalized.length > 1 && normalized.includes('+')) {
      normalized = normalized.replace(/\s*\+\s*/g, ' ');
    }
    // Normalize whitespace
    if (/\s/.test(normalized)) {
      normalized = normalized.replace(/\s+/g, ' ');
    }

    // Split by space and transform common key names
    const parts = normalized.split(' ').map((part) => {
      // Map common key aliases
      if (part.toLowerCase() === 'ctrl') return 'Control';
      if (part.toLowerCase() === 'cmd' || part.toLowerCase() === 'command')
        return 'Meta';
      if (part.toLowerCase() === 'alt' || part.toLowerCase() === 'option')
        return 'Alt';
      return part;
    });

    result.push(...parts);
  }

  return result;
}

/**
 * Get key commands from key name string
 */
function getKeyCommands(
  value: string | string[],
): Array<{ key: string; command?: string }> {
  const keys = normalizeKeyInputs(value);

  return keys.reduce((acc: Array<{ key: string; command?: string }>, k) => {
    const includeMeta = keys.includes('Meta') || keys.includes('Control');
    if (includeMeta && (k === 'a' || k === 'A')) {
      return acc.concat([{ key: k, command: 'SelectAll' }]);
    }
    if (includeMeta && (k === 'c' || k === 'C')) {
      return acc.concat([{ key: k, command: 'Copy' }]);
    }
    if (includeMeta && (k === 'v' || k === 'V')) {
      return acc.concat([{ key: k, command: 'Paste' }]);
    }
    return acc.concat([{ key: k }]);
  }, []);
}

/**
 * Build the action space using defineAction* helpers from @midscene/core/device
 * This function is called once and cached.
 */
async function buildActionSpace(page: HostWebPage): Promise<unknown[]> {
  try {
    // Dynamically import to avoid bundling issues when @midscene/core is not available
    const {
      defineActionTap,
      defineActionRightClick,
      defineActionDoubleClick,
      defineActionHover,
      defineActionInput,
      defineActionKeyboardPress,
      defineActionScroll,
      defineActionDragAndDrop,
      defineActionLongPress,
      defineActionClearInput,
    } = await import('@midscene/core/device');

    return [
      // Tap action
      defineActionTap(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot tap');
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'left',
        });
      }),

      // Right click action
      defineActionRightClick(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot right click');
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'right',
        });
      }),

      // Double click action
      defineActionDoubleClick(
        async (param: { locate: LocateResultElement }) => {
          const element = param.locate;
          if (!element)
            throw new Error('Element not found, cannot double click');
          await page.mouse.click(element.center[0], element.center[1], {
            button: 'left',
            count: 2,
          });
        },
      ),

      // Hover action
      defineActionHover(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot hover');
        await page.mouse.move(element.center[0], element.center[1]);
      }),

      // Input action
      defineActionInput(
        async (param: {
          value: string;
          locate?: LocateResultElement;
          mode?: 'replace' | 'clear' | 'append';
        }) => {
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
        },
      ),

      // Keyboard press action
      defineActionKeyboardPress(
        async (param: { locate?: LocateResultElement; keyName: string }) => {
          const element = param.locate;
          if (element) {
            await page.mouse.click(element.center[0], element.center[1], {
              button: 'left',
            });
          }

          const keys = getKeyCommands(param.keyName);
          await page.keyboard.press(
            keys as { key: KeyInput; command?: string }[],
          );
        },
      ),

      // Scroll action
      defineActionScroll(async (param: ActionScrollParam) => {
        const element = param.locate;
        const startingPoint = element
          ? {
              left: element.center[0],
              top: element.center[1],
            }
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
          throw new Error(
            `Unknown scroll event type: ${scrollToEventName}, param: ${JSON.stringify(
              param,
            )}`,
          );
        }
      }),

      // Drag and drop action
      defineActionDragAndDrop(
        async (param: {
          from: LocateResultElement;
          to: LocateResultElement;
        }) => {
          const from = param.from;
          const to = param.to;
          if (!from) throw new Error('missing "from" param for drag and drop');
          if (!to) throw new Error('missing "to" param for drag and drop');
          await page.mouse.drag(
            {
              x: from.center[0],
              y: from.center[1],
            },
            {
              x: to.center[0],
              y: to.center[1],
            },
          );
        },
      ),

      // Long press action
      defineActionLongPress(
        async (param: { locate: LocateResultElement; duration?: number }) => {
          const element = param.locate;
          if (!element) throw new Error('Element not found, cannot long press');
          const duration = param?.duration;
          await page.longPress(element.center[0], element.center[1], duration);
        },
      ),

      // Clear input action
      defineActionClearInput(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot clear input');
        await page.clearInput(element as unknown as ElementInfo);
      }),
    ];
  } catch (error) {
    // Fallback: return empty array if @midscene/core is not available
    console.warn(
      '[HostWebPage] @midscene/core/device not available, actionSpace is empty:',
      error,
    );
    return [];
  }
}

/**
 * HostWebPage implements Midscene's AbstractWebPage interface for rstest host-side.
 *
 * It uses Playwright's Page and Frame objects directly to control the browser iframe.
 * The actionSpace() method uses Midscene's defineAction* helpers to provide
 * the standard set of web actions (tap, click, input, scroll, etc.).
 */
export class HostWebPage {
  readonly interfaceType: string = 'rstest-host';

  private containerPage: Page;
  private iframeElement: ElementHandle<HTMLIFrameElement>;
  private frame: Frame;
  private cachedSize: Size | null = null;
  private iframeBoundingBox: { x: number; y: number } | null = null;
  private everMoved = false;
  private actionSpaceCache: unknown[] | null = null;
  private actionSpacePromise: Promise<unknown[]> | null = null;

  constructor(
    containerPage: Page,
    iframeElement: ElementHandle<HTMLIFrameElement>,
    frame: Frame,
  ) {
    this.containerPage = containerPage;
    this.iframeElement = iframeElement;
    this.frame = frame;
  }

  updateBindings(
    containerPage: Page,
    iframeElement: ElementHandle<HTMLIFrameElement>,
    frame: Frame,
  ): void {
    this.containerPage = containerPage;
    this.iframeElement = iframeElement;
    this.frame = frame;
    this.cachedSize = null;
    this.iframeBoundingBox = null;
    this.everMoved = false;
  }

  /**
   * Take a screenshot and return as base64 string
   */
  async screenshotBase64(): Promise<string> {
    const buffer = await this.iframeElement.screenshot({
      type: 'jpeg',
      quality: 90,
    });
    // Return with data URI prefix for Midscene compatibility
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  /**
   * Get viewport size
   */
  async size(): Promise<Size> {
    if (this.cachedSize) {
      return this.cachedSize;
    }

    const size = await this.frame.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      dpr: window.devicePixelRatio,
    }));

    this.cachedSize = size;
    return this.cachedSize;
  }

  /**
   * Get iframe bounding box for coordinate offset calculation
   */
  private async getIframeBoundingBox(): Promise<{ x: number; y: number }> {
    if (this.iframeBoundingBox) {
      return this.iframeBoundingBox;
    }

    const box = await this.iframeElement.boundingBox();
    if (!box) {
      throw new Error('Cannot get iframe bounding box');
    }

    this.iframeBoundingBox = { x: box.x, y: box.y };
    return this.iframeBoundingBox;
  }

  /**
   * Get available actions for this device.
   * Uses Midscene's defineAction* helpers for standard web actions.
   *
   * Note: This is synchronous but we cache the result from the async build.
   * The first call to agent methods will trigger the async build.
   */
  actionSpace(): unknown[] {
    // If we have cached actions, return them
    if (this.actionSpaceCache) {
      return this.actionSpaceCache;
    }

    // Start building if not already in progress
    if (!this.actionSpacePromise) {
      this.actionSpacePromise = buildActionSpace(this).then((actions) => {
        this.actionSpaceCache = actions;
        return actions;
      });
    }

    // Return empty array for now - actions will be available after first screenshot
    // This is a workaround for the sync/async mismatch in Midscene's interface
    return [];
  }

  /**
   * Ensure action space is built (call this before using the agent)
   */
  async ensureActionSpace(): Promise<unknown[]> {
    if (this.actionSpaceCache) {
      return this.actionSpaceCache;
    }

    if (!this.actionSpacePromise) {
      this.actionSpacePromise = buildActionSpace(this).then((actions) => {
        this.actionSpaceCache = actions;
        return actions;
      });
    }

    return this.actionSpacePromise;
  }

  /**
   * Get current page URL
   */
  async url(): Promise<string> {
    return this.frame.url();
  }

  /**
   * Describe the current page (returns URL)
   */
  describe(): string {
    return this.frame.url();
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluateJavaScript<T = unknown>(script: string): Promise<T> {
    return this.frame.evaluate(script) as Promise<T>;
  }

  // ============================================================================
  // Mouse interface (matches AbstractWebPage)
  // ============================================================================

  get mouse(): MouseAction {
    const page = this;
    return {
      async click(
        x: number,
        y: number,
        options?: { button?: MouseButton; count?: number },
      ): Promise<void> {
        const box = await page.getIframeBoundingBox();
        const absoluteX = box.x + x;
        const absoluteY = box.y + y;
        const { button = 'left', count = 1 } = options || {};

        if (count === 2) {
          await page.containerPage.mouse.dblclick(absoluteX, absoluteY, {
            button,
          });
        } else {
          await page.containerPage.mouse.click(absoluteX, absoluteY, {
            button,
          });
        }
      },

      async wheel(deltaX: number, deltaY: number): Promise<void> {
        await page.containerPage.mouse.wheel(deltaX, deltaY);
      },

      async move(x: number, y: number): Promise<void> {
        const box = await page.getIframeBoundingBox();
        const absoluteX = box.x + x;
        const absoluteY = box.y + y;
        page.everMoved = true;
        await page.containerPage.mouse.move(absoluteX, absoluteY);
      },

      async drag(
        from: { x: number; y: number },
        to: { x: number; y: number },
      ): Promise<void> {
        const box = await page.getIframeBoundingBox();
        const absoluteFromX = box.x + from.x;
        const absoluteFromY = box.y + from.y;
        const absoluteToX = box.x + to.x;
        const absoluteToY = box.y + to.y;

        await page.containerPage.mouse.move(absoluteFromX, absoluteFromY);
        await sleep(200);
        await page.containerPage.mouse.down();
        await sleep(300);

        // Move in steps for smooth drag
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          const x = absoluteFromX + (absoluteToX - absoluteFromX) * (i / steps);
          const y = absoluteFromY + (absoluteToY - absoluteFromY) * (i / steps);
          await page.containerPage.mouse.move(x, y);
        }

        await sleep(500);
        await page.containerPage.mouse.up();
        await sleep(200);
      },
    };
  }

  // ============================================================================
  // Keyboard interface (matches AbstractWebPage)
  // ============================================================================

  get keyboard(): KeyboardAction {
    const page = this;
    return {
      async type(text: string): Promise<void> {
        await page.containerPage.keyboard.type(text, { delay: 80 });
      },

      async press(
        action:
          | { key: KeyInput; command?: string }
          | { key: KeyInput; command?: string }[],
      ): Promise<void> {
        const keys = Array.isArray(action) ? action : [action];
        for (const k of keys) {
          await page.containerPage.keyboard.down(k.key);
        }
        for (const k of [...keys].reverse()) {
          await page.containerPage.keyboard.up(k.key);
        }
      },
    };
  }

  // ============================================================================
  // Scroll methods (required by AbstractWebPage)
  // ============================================================================

  private async moveToPointBeforeScroll(point?: Point): Promise<void> {
    if (point) {
      await this.mouse.move(point.left, point.top);
    } else if (!this.everMoved) {
      const size = await this.size();
      const targetX = Math.floor(size.width / 2);
      const targetY = Math.floor(size.height / 2);
      await this.mouse.move(targetX, targetY);
    }
  }

  async scrollUntilTop(startingPoint?: Point): Promise<void> {
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(0, -9999999);
  }

  async scrollUntilBottom(startingPoint?: Point): Promise<void> {
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(0, 9999999);
  }

  async scrollUntilLeft(startingPoint?: Point): Promise<void> {
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(-9999999, 0);
  }

  async scrollUntilRight(startingPoint?: Point): Promise<void> {
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(9999999, 0);
  }

  async scrollUp(distance?: number, startingPoint?: Point): Promise<void> {
    const innerHeight = await this.frame.evaluate(() => window.innerHeight);
    const scrollDistance = distance || innerHeight * 0.7;
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(0, -scrollDistance);
  }

  async scrollDown(distance?: number, startingPoint?: Point): Promise<void> {
    const innerHeight = await this.frame.evaluate(() => window.innerHeight);
    const scrollDistance = distance || innerHeight * 0.7;
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(0, scrollDistance);
  }

  async scrollLeft(distance?: number, startingPoint?: Point): Promise<void> {
    const innerWidth = await this.frame.evaluate(() => window.innerWidth);
    const scrollDistance = distance || innerWidth * 0.7;
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(-scrollDistance, 0);
  }

  async scrollRight(distance?: number, startingPoint?: Point): Promise<void> {
    const innerWidth = await this.frame.evaluate(() => window.innerWidth);
    const scrollDistance = distance || innerWidth * 0.7;
    await this.moveToPointBeforeScroll(startingPoint);
    await this.mouse.wheel(scrollDistance, 0);
  }

  // ============================================================================
  // Touch/gesture methods (required by AbstractWebPage)
  // ============================================================================

  async longPress(x: number, y: number, duration = 500): Promise<void> {
    const box = await this.getIframeBoundingBox();
    const absoluteX = box.x + x;
    const absoluteY = box.y + y;

    const LONG_PRESS_THRESHOLD = 600;
    const MIN_PRESS_THRESHOLD = 300;
    let pressDuration = duration;
    if (pressDuration > LONG_PRESS_THRESHOLD) {
      pressDuration = LONG_PRESS_THRESHOLD;
    }
    if (pressDuration < MIN_PRESS_THRESHOLD) {
      pressDuration = MIN_PRESS_THRESHOLD;
    }

    await this.containerPage.mouse.move(absoluteX, absoluteY);
    await this.containerPage.mouse.down({ button: 'left' });
    await sleep(pressDuration);
    await this.containerPage.mouse.up({ button: 'left' });
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration = 100,
  ): Promise<void> {
    const box = await this.getIframeBoundingBox();
    const absoluteFromX = box.x + from.x;
    const absoluteFromY = box.y + from.y;
    const absoluteToX = box.x + to.x;
    const absoluteToY = box.y + to.y;

    const LONG_PRESS_THRESHOLD = 500;
    const MIN_PRESS_THRESHOLD = 150;
    let swipeDuration = duration;
    if (swipeDuration < MIN_PRESS_THRESHOLD) {
      swipeDuration = MIN_PRESS_THRESHOLD;
    }
    if (swipeDuration > LONG_PRESS_THRESHOLD) {
      swipeDuration = LONG_PRESS_THRESHOLD;
    }

    await this.containerPage.mouse.move(absoluteFromX, absoluteFromY);
    await this.containerPage.mouse.down();

    const steps = 30;
    const delay = swipeDuration / steps;
    for (let i = 1; i <= steps; i++) {
      const x = absoluteFromX + (absoluteToX - absoluteFromX) * (i / steps);
      const y = absoluteFromY + (absoluteToY - absoluteFromY) * (i / steps);
      await this.containerPage.mouse.move(x, y);
      await sleep(delay);
    }

    await this.containerPage.mouse.up({ button: 'left' });
  }

  // ============================================================================
  // Input helper methods
  // ============================================================================

  /**
   * Clear input field - clicks element and selects all then deletes
   */
  async clearInput(element: ElementInfo): Promise<void> {
    if (!element) {
      console.warn('No element to clear input');
      return;
    }

    const backspace = async () => {
      await sleep(100);
      await this.keyboard.press([{ key: 'Backspace' }]);
    };

    const isMac = process.platform === 'darwin';

    // Click the element
    await this.mouse.click(element.center[0], element.center[1], {
      button: 'left',
    });

    // Triple-click to select all (works in most input fields)
    await this.mouse.click(element.center[0], element.center[1], {
      button: 'left',
      count: 1,
    });

    // Select all with keyboard shortcut
    if (isMac) {
      await this.containerPage.keyboard.down('Meta');
      await this.containerPage.keyboard.press('a');
      await this.containerPage.keyboard.up('Meta');
    } else {
      await this.containerPage.keyboard.down('Control');
      await this.containerPage.keyboard.press('a');
      await this.containerPage.keyboard.up('Control');
    }
    await backspace();
  }

  // ============================================================================
  // Lifecycle methods
  // ============================================================================

  async destroy(): Promise<void> {
    this.cachedSize = null;
    this.iframeBoundingBox = null;
    this.actionSpaceCache = null;
    this.actionSpacePromise = null;
  }

  async beforeInvokeAction(_name: string, _param: unknown): Promise<void> {
    // Refresh iframe bounding box before each action in case it moved
    this.iframeBoundingBox = null;
    // Ensure action space is ready
    await this.ensureActionSpace();
  }

  async afterInvokeAction(_name: string, _param: unknown): Promise<void> {
    // No-op
  }
}
