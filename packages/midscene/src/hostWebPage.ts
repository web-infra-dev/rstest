/**
 * HostWebPage - Midscene AbstractWebPage implementation for rstest host-side
 *
 * This class extends Midscene's AbstractWebPage by using Playwright's Page and Frame
 * objects to control the browser iframe. It provides the interface that Midscene's
 * Agent needs to perform AI-driven operations.
 */

import type { ElementHandle, Frame, Page } from 'playwright';

type Point = {
  left: number;
  top: number;
};

interface ElementInfo {
  center: [number, number];
}

type Size = {
  width: number;
  height: number;
  dpr?: number;
};

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MouseButton = 'left' | 'right' | 'middle';

type KeyInput = string;

interface LocateResultElement {
  center: [number, number];
}

interface ActionScrollParam {
  direction?: 'up' | 'down' | 'left' | 'right';
  scrollType?: string;
  distance?: number | null;
  locate?: LocateResultElement;
}

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

interface KeyboardAction {
  type: (text: string) => Promise<void>;
  press: (
    action:
      | { key: KeyInput; command?: string }
      | { key: KeyInput; command?: string }[],
  ) => Promise<void>;
}

interface FileChooserBridge {
  accept: (files: string[]) => Promise<void>;
}

interface FileChooserListenerRegistration {
  dispose: () => void;
  getError: () => Error | undefined;
}

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
    // Accept both "Ctrl+A" and "Ctrl A" styles.
    if (normalized.length > 1 && normalized.includes('+')) {
      normalized = normalized.replace(/\s*\+\s*/g, ' ');
    }

    if (/\s/.test(normalized)) {
      normalized = normalized.replace(/\s+/g, ' ');
    }

    const parts = normalized.split(' ').map((part) => {
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
    // Keep this import dynamic to avoid hard failure when the host package is
    // consumed without Midscene runtime dependencies.
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
      defineActionTap(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot tap');
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'left',
        });
      }),

      defineActionRightClick(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot right click');
        await page.mouse.click(element.center[0], element.center[1], {
          button: 'right',
        });
      }),

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

      defineActionHover(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot hover');
        await page.mouse.move(element.center[0], element.center[1]);
      }),

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
            return;
          }

          if (!param || !param.value) {
            return;
          }

          await page.keyboard.type(param.value);
        },
      ),

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

          // Some scroll actions are async from the app's perspective.
          await sleep(500);
        } else {
          throw new Error(
            `Unknown scroll event type: ${scrollToEventName}, param: ${JSON.stringify(
              param,
            )}`,
          );
        }
      }),

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

      defineActionLongPress(
        async (param: { locate: LocateResultElement; duration?: number }) => {
          const element = param.locate;
          if (!element) throw new Error('Element not found, cannot long press');
          const duration = param?.duration;
          await page.longPress(element.center[0], element.center[1], duration);
        },
      ),

      defineActionClearInput(async (param: { locate: LocateResultElement }) => {
        const element = param.locate;
        if (!element) throw new Error('Element not found, cannot clear input');
        await page.clearInput(element as unknown as ElementInfo);
      }),
    ];
  } catch (error) {
    console.warn(
      '[HostWebPage] @midscene/core/device not available, actionSpace is empty:',
      error,
    );
    return [];
  }
}

/**
 * Host-side implementation of Midscene's interface contract for rstest browser mode.
 *
 * Coordinates are always relative to the runner iframe and translated back to
 * container-page coordinates before being sent to Playwright.
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

  async screenshotBase64(): Promise<string> {
    const buffer = await this.iframeElement.screenshot({
      type: 'jpeg',
      quality: 90,
    });

    // Midscene expects a data URI payload.
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

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
   * Midscene reads actionSpace synchronously. We lazily start async construction
   * and return an empty array until the promise resolves.
   */
  actionSpace(): unknown[] {
    if (this.actionSpaceCache) {
      return this.actionSpaceCache;
    }

    if (!this.actionSpacePromise) {
      this.actionSpacePromise = buildActionSpace(this).then((actions) => {
        this.actionSpaceCache = actions;
        return actions;
      });
    }

    return [];
  }

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

  async url(): Promise<string> {
    return this.frame.url();
  }

  describe(): string {
    return this.frame.url();
  }

  async evaluateJavaScript<T = unknown>(script: string): Promise<T> {
    return this.frame.evaluate(script) as Promise<T>;
  }

  /**
   * TODO(midscene-file-upload): bridge `filechooser` events from Playwright.
   *
   * Midscene's `fileChooserAccept` option requires this hook. In rstest browser
   * mode we need to map container-page file chooser events back to the current
   * runner iframe and keep isolation across test files/runs.
   *
   * This is intentionally unimplemented for now to avoid cross-iframe leakage.
   */
  async registerFileChooserListener(
    _handler: (chooser: FileChooserBridge) => Promise<void>,
  ): Promise<FileChooserListenerRegistration> {
    throw new Error(
      '[rstest:midscene] fileChooserAccept is not implemented in HostWebPage yet. ' +
        'TODO: add a Playwright filechooser bridge with iframe-level isolation.',
    );
  }

  /**
   * Build stable locate cache hints for Midscene.
   *
   * We derive candidate selectors from the element under the provided rect center.
   */
  async cacheFeatureForRect(rect: Rect): Promise<Record<string, unknown>> {
    return this.frame.evaluate((rawRect) => {
      const clamp = (value: number, min: number, max: number): number =>
        Math.min(Math.max(value, min), max);

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const centerX = clamp(
        rawRect.left + rawRect.width / 2,
        0,
        Math.max(0, width - 1),
      );
      const centerY = clamp(
        rawRect.top + rawRect.height / 2,
        0,
        Math.max(0, height - 1),
      );

      const target = document.elementFromPoint(centerX, centerY);
      if (!(target instanceof Element)) {
        return {};
      }

      const xpaths: string[] = [];
      const appendXPath = (xpath?: string | null): void => {
        if (!xpath) {
          return;
        }
        if (!xpaths.includes(xpath)) {
          xpaths.push(xpath);
        }
      };

      const quoteXPathLiteral = (value: string): string => {
        if (!value.includes("'")) {
          return `'${value}'`;
        }
        if (!value.includes('"')) {
          return `"${value}"`;
        }
        return `concat('${value.replace(/'/g, `',"'",'`)}')`;
      };

      const toAbsoluteXPath = (element: Element): string => {
        if (element.id) {
          return `//*[@id=${quoteXPathLiteral(element.id)}]`;
        }

        const segments: string[] = [];
        let current: Element | null = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
          const tagName = current.tagName.toLowerCase();
          if (!current.parentElement) {
            segments.unshift(tagName);
            break;
          }

          const siblings = Array.from(current.parentElement.children).filter(
            (sibling) => sibling.tagName === current?.tagName,
          );
          const index = siblings.indexOf(current) + 1;
          segments.unshift(`${tagName}[${index}]`);
          current = current.parentElement;
        }

        return `/${segments.join('/')}`;
      };

      appendXPath(
        target.id ? `//*[@id=${quoteXPathLiteral(target.id)}]` : null,
      );

      const testId = target.getAttribute('data-testid');
      appendXPath(
        testId ? `//*[@data-testid=${quoteXPathLiteral(testId)}]` : null,
      );

      const role = target.getAttribute('role');
      appendXPath(role ? `//*[@role=${quoteXPathLiteral(role)}]` : null);

      appendXPath(toAbsoluteXPath(target));

      return xpaths.length > 0 ? { xpaths } : {};
    }, rect);
  }

  /**
   * Resolve cached selectors to the first visible element rectangle.
   */
  async rectMatchesCacheFeature(
    feature: Record<string, unknown>,
  ): Promise<Rect> {
    return this.frame.evaluate((rawFeature) => {
      const cacheFeature = rawFeature as { xpaths?: unknown };
      const xpaths = Array.isArray(cacheFeature?.xpaths)
        ? cacheFeature.xpaths.filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0,
          )
        : [];

      if (xpaths.length === 0) {
        throw new Error('Cache feature does not contain xpaths');
      }

      for (const xpath of xpaths) {
        const node = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;

        if (!(node instanceof Element)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      throw new Error('No matching element found for cache feature');
    }, feature);
  }

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

  /**
   * Clear text by focusing, selecting all, then issuing Backspace.
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

    await this.mouse.click(element.center[0], element.center[1], {
      button: 'left',
    });

    await this.mouse.click(element.center[0], element.center[1], {
      button: 'left',
      count: 1,
    });

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

  async destroy(): Promise<void> {
    this.cachedSize = null;
    this.iframeBoundingBox = null;
    this.actionSpaceCache = null;
    this.actionSpacePromise = null;
  }

  async beforeInvokeAction(_name: string, _param: unknown): Promise<void> {
    // Layout can shift after each action, so refresh offsets aggressively.
    this.iframeBoundingBox = null;
    await this.ensureActionSpace();
  }

  async afterInvokeAction(_name: string, _param: unknown): Promise<void> {}
}
