/**
 * Contains adapted logic from Playwright matchers:
 * https://github.com/microsoft/playwright/blob/main/packages/playwright/src/matchers/matchers.ts
 * Copyright (c) Microsoft Corporation, Apache-2.0.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { FrameLocator, Locator, Page } from 'playwright';
import { PNG } from 'pngjs';
import {
  supportedScreenshotMatchers,
  supportedExpectElementMatchers,
  supportedLocatorActions,
} from '../../browserRpcRegistry';
import type {
  BrowserLocatorIR,
  BrowserLocatorText,
  BrowserRpcRequest,
} from '../../rpcProtocol';
import { compilePlaywrightLocator } from './compileLocator';
import { formatExpectError, serializeExpectedText } from './expectUtils';

const MIN_SCREENSHOT_STABILITY_TIMEOUT = 100;

// ---------------------------------------------------------------------------
// Iframe lookup
// ---------------------------------------------------------------------------

const escapeCssAttrValue = (value: string): string => {
  return value
    .replace(/[\\']/g, '\\$&')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code === 0) {
        return '\uFFFD';
      }
      return code <= 0x1f || code === 0x7f
        ? `\\${code.toString(16)} `
        : character;
    })
    .join('');
};

const getRunnerFrame = async (
  containerPage: Page,
  testPath: string,
  projectName: string,
  timeoutMs: number,
): Promise<{ frame: FrameLocator; iframe: Locator }> => {
  const selector =
    `iframe[data-test-file='${escapeCssAttrValue(testPath)}']` +
    `[data-test-project='${escapeCssAttrValue(projectName)}']`;
  const iframe = containerPage.locator(selector);

  const count = await iframe.count();
  if (count === 0) {
    const known = await containerPage
      .locator('iframe[data-test-file]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const iframe = n as HTMLIFrameElement;
          return {
            testPath: iframe.dataset.testFile,
            projectName: iframe.dataset.testProject,
          };
        }),
      );
    throw new Error(
      `Runner iframe not found for testPath ${JSON.stringify(testPath)} and project ${JSON.stringify(projectName)}. ` +
        `Known iframes: ${JSON.stringify(known)}. ` +
        `Timeout: ${timeoutMs}ms`,
    );
  }

  return { frame: containerPage.frameLocator(selector), iframe };
};

// ---------------------------------------------------------------------------
// Table-driven expect matcher dispatch
// ---------------------------------------------------------------------------

type PlaywrightExpectResult = {
  matches: boolean;
  errorMessage?: string;
  log?: string[];
};

/**
 * Playwright re-checks a pending assertion at growing intervals of up to
 * 500ms, so a condition that becomes true between two checks is noticed up to
 * 500ms late. The full-timeout call stays the authority for the deadline and
 * the failure report; short probes only end the wait early once the condition
 * holds, and abort the full call (Playwright >= 1.62 honours the signal).
 */
const EXPECT_PROBE_INTERVAL_MS = 50;

const expectWithProbes = async (
  locator: Locator,
  expectMethod: string,
  options: { isNot: boolean; timeout: number } & Record<string, unknown>,
): Promise<PlaywrightExpectResult> => {
  const expectOnce = (
    overrides: Record<string, unknown>,
  ): Promise<PlaywrightExpectResult> =>
    (locator as any)._expect(expectMethod, { ...options, ...overrides });

  // An explicit `timeout: 0` means "no deadline" to Playwright, so it is probed too.
  if (options.timeout !== 0 && options.timeout <= EXPECT_PROBE_INTERVAL_MS) {
    return expectOnce({});
  }

  const fullCall = new AbortController();
  const probing = new AbortController();
  const probe = async (): Promise<PlaywrightExpectResult> => {
    while (true) {
      await delay(EXPECT_PROBE_INTERVAL_MS, undefined, {
        signal: probing.signal,
      });
      // `timeout: 0` would wait forever; 1ms makes the probe a single check.
      // Probe errors are left for the full call to report.
      const result = await expectOnce({ timeout: 1 }).catch(() => undefined);
      if (result?.matches === !options.isNot) {
        fullCall.abort();
        return result;
      }
    }
  };

  try {
    return await Promise.race([
      expectOnce({ signal: fullCall.signal }),
      probe(),
    ]);
  } finally {
    probing.abort();
  }
};

/**
 * Calls Playwright's internal `_expect()` and throws on mismatch.
 *
 * NOTE: `_expect()` is a Playwright semi-internal API used by its own test
 * runner to implement all web-first assertions. It is not part of the public
 * docs but is stable across minor versions. All Playwright-specific coupling
 * is intentionally confined to this provider module.
 * See: https://github.com/nicolo-ribaudo/playwright/blob/HEAD/packages/playwright-core/src/client/locator.ts
 */
const callExpect = async (
  locator: Locator,
  expectMethod: string,
  options: { isNot: boolean; timeout: number } & Record<string, unknown>,
  fallbackMessage: string,
): Promise<null> => {
  const result = await expectWithProbes(locator, expectMethod, options);
  if (result.matches !== !options.isNot) {
    throw new Error(formatExpectError(result) || fallbackMessage);
  }
  return null;
};

const normalizePlaywrightTimeout = (
  timeout: number,
  isExplicit: boolean,
): number => (isExplicit ? timeout : Math.max(timeout, 1));

const assertSerializedText = (
  value: unknown,
  matcherName: string,
): BrowserLocatorText => {
  const t = value as any;
  if (!t || (t.type !== 'string' && t.type !== 'regexp')) {
    throw new Error(`${matcherName} expects a serialized text matcher`);
  }
  return t as BrowserLocatorText;
};

const assertStringArg = (
  value: unknown,
  matcherName: string,
  label: string,
): string => {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${matcherName} expects ${label}`);
  }
  return value;
};

const captureStableScreenshot = async (
  target: Locator | Page,
  options: Record<string, unknown>,
  requestDeadline: number | undefined,
  beforeCapture?: () => Promise<void>,
): Promise<Buffer> => {
  const { stabilityTimeout = 2_000, ...playwrightOptions } = options;
  if (
    typeof stabilityTimeout !== 'number' ||
    !Number.isFinite(stabilityTimeout) ||
    stabilityTimeout < 0 ||
    (stabilityTimeout > 0 &&
      stabilityTimeout < MIN_SCREENSHOT_STABILITY_TIMEOUT)
  ) {
    throw new Error(
      `toMatchScreenshot stabilityTimeout must be 0 or at least ${MIN_SCREENSHOT_STABILITY_TIMEOUT}ms.`,
    );
  }
  const screenshotOptions = { animations: 'disabled', ...playwrightOptions };
  const capture = async (deadline = requestDeadline) => {
    await beforeCapture?.();
    const timeout = deadline ? deadline - Date.now() : undefined;
    if (timeout !== undefined && timeout <= 0) {
      throw new Error('Screenshot capture exceeded the active test timeout.');
    }
    return target.screenshot({
      ...screenshotOptions,
      ...(timeout === undefined ? {} : { timeout }),
    } as any);
  };
  let previous = await capture();
  if (stabilityTimeout === 0) return previous;

  const stabilityDeadline = Date.now() + stabilityTimeout;
  while (
    Date.now() < stabilityDeadline &&
    (!requestDeadline || Date.now() < requestDeadline)
  ) {
    const requestDelay = requestDeadline
      ? requestDeadline - Date.now()
      : Number.POSITIVE_INFINITY;
    const delay = Math.min(50, stabilityDeadline - Date.now(), requestDelay);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (requestDeadline && Date.now() >= requestDeadline) {
      throw new Error('Screenshot capture exceeded the active test timeout.');
    }
    if (Date.now() >= stabilityDeadline) {
      throw new Error(
        `Screenshot did not become stable within ${stabilityTimeout}ms. Increase stabilityTimeout or mask dynamic content.`,
      );
    }
    const captureDeadline = requestDeadline
      ? Math.min(requestDeadline, stabilityDeadline)
      : stabilityDeadline;
    const current = await capture(captureDeadline);
    if (Date.now() >= stabilityDeadline) {
      throw new Error(
        `Screenshot did not become stable within ${stabilityTimeout}ms. Increase stabilityTimeout or mask dynamic content.`,
      );
    }
    const before = PNG.sync.read(previous);
    const after = PNG.sync.read(current);
    if (
      before.width === after.width &&
      before.height === after.height &&
      before.data.equals(after.data)
    ) {
      return current;
    }
    previous = current;
  }

  throw new Error(
    `Screenshot did not become stable within ${stabilityTimeout}ms. Increase stabilityTimeout or mask dynamic content.`,
  );
};

const readScreenshotOptions = async (
  root: FrameLocator | Page,
  value: unknown,
): Promise<Record<string, unknown>> => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('toMatchScreenshot options must be an object.');
  }
  const options = { ...(value as Record<string, unknown>) };
  const supportedOptions = new Set([
    'threshold',
    'maxDiffPixels',
    'maxDiffPixelRatio',
    'stabilityTimeout',
    'mask',
    'maskColor',
    'fullPage',
    'style',
    'caret',
    'scale',
    'omitBackground',
  ]);
  const unsupportedOption = Object.keys(options).find(
    (key) => !supportedOptions.has(key),
  );
  if (unsupportedOption) {
    throw new Error(
      `Unsupported toMatchScreenshot option: ${unsupportedOption}`,
    );
  }

  const mask = options.mask;
  delete options.mask;
  if (mask !== undefined) {
    if (!Array.isArray(mask)) {
      throw new Error('toMatchScreenshot mask must be an array of Locators.');
    }
    options.mask = mask.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new Error('toMatchScreenshot mask must contain Locators.');
      }
      return compilePlaywrightLocator(root, item as BrowserLocatorIR);
    });
  }

  return {
    ...(options.stabilityTimeout === undefined
      ? {}
      : { stabilityTimeout: options.stabilityTimeout }),
    ...(options.mask === undefined ? {} : { mask: options.mask }),
    ...(options.maskColor === undefined
      ? {}
      : { maskColor: options.maskColor }),
    ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
    ...(options.style === undefined ? {} : { style: options.style }),
    ...(options.caret === undefined ? {} : { caret: options.caret }),
    ...(options.scale === undefined ? {} : { scale: options.scale }),
    ...(options.omitBackground === undefined
      ? {}
      : { omitBackground: options.omitBackground }),
  };
};

/** Simple boolean state matchers — no extra args. */
const simpleMatchers: Record<string, string> = {
  toBeVisible: 'to.be.visible',
  toBeHidden: 'to.be.hidden',
  toBeEnabled: 'to.be.enabled',
  toBeDisabled: 'to.be.disabled',
  toBeAttached: 'to.be.attached',
  toBeDetached: 'to.be.detached',
  toBeEditable: 'to.be.editable',
  toBeFocused: 'to.be.focused',
  toBeEmpty: 'to.be.empty',
};

/** Text matchers that take a single serialized text arg. */
const textMatchers: Record<
  string,
  {
    expectMethod: string;
    textOptions?: { matchSubstring?: boolean; normalizeWhiteSpace?: boolean };
  }
> = {
  toHaveId: { expectMethod: 'to.have.id' },
  toHaveText: {
    expectMethod: 'to.have.text',
    textOptions: { normalizeWhiteSpace: true },
  },
  toContainText: {
    expectMethod: 'to.have.text',
    textOptions: { matchSubstring: true, normalizeWhiteSpace: true },
  },
  toHaveValue: { expectMethod: 'to.have.value' },
  toHaveClass: { expectMethod: 'to.have.class' },
};

/**
 * Dispatches an expect matcher call on the given Playwright locator.
 * Returns `null` on success, throws on mismatch or invalid args.
 */
const dispatchExpectMatcher = (
  locator: Locator,
  request: BrowserRpcRequest,
  isNot: boolean,
  timeout: number,
): Promise<null> => {
  const { method, args } = request;

  // --- Simple boolean state matchers ---
  const simpleExpect = simpleMatchers[method];
  if (simpleExpect) {
    return callExpect(
      locator,
      simpleExpect,
      { isNot, timeout },
      `Expected element ${method
        .replace('toBe', 'to be ')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase()}`,
    );
  }

  // --- Text matchers (single serialized text arg) ---
  const textDef = textMatchers[method];
  if (textDef) {
    const expected = assertSerializedText(args[0], method);
    return callExpect(
      locator,
      textDef.expectMethod,
      {
        isNot,
        timeout,
        expectedText: serializeExpectedText(expected, textDef.textOptions),
      },
      `Expected element ${method}`,
    );
  }

  // --- Matchers with custom arg handling ---
  switch (method) {
    case 'toBeInViewport': {
      const ratio = args[0];
      if (ratio !== undefined && typeof ratio !== 'number') {
        throw new Error(
          `toBeInViewport expects ratio to be a number, got ${typeof ratio}`,
        );
      }
      return callExpect(
        locator,
        'to.be.in.viewport',
        { isNot, timeout, expectedNumber: ratio },
        'Expected element to be in viewport',
      );
    }
    case 'toBeChecked':
      return callExpect(
        locator,
        'to.be.checked',
        { isNot, timeout, expectedValue: { checked: true } },
        'Expected element to be checked',
      );
    case 'toBeUnchecked':
      return callExpect(
        locator,
        'to.be.checked',
        { isNot, timeout, expectedValue: { checked: false } },
        'Expected element to be unchecked',
      );
    case 'toHaveCount': {
      const expected = args[0];
      if (typeof expected !== 'number') {
        throw new Error(`toHaveCount expects a number, got ${typeof expected}`);
      }
      return callExpect(
        locator,
        'to.have.count',
        { isNot, timeout, expectedNumber: expected },
        `Expected count ${expected}`,
      );
    }
    case 'toHaveAttribute': {
      const name = assertStringArg(
        args[0],
        'toHaveAttribute',
        'an attribute name',
      );
      if (args.length < 2) {
        return callExpect(
          locator,
          'to.have.attribute',
          { isNot, timeout, expressionArg: name },
          `Expected attribute ${name} to be present`,
        );
      }
      const expected = assertSerializedText(args[1], 'toHaveAttribute');
      return callExpect(
        locator,
        'to.have.attribute.value',
        {
          isNot,
          timeout,
          expressionArg: name,
          expectedText: serializeExpectedText(expected),
        },
        `Expected attribute ${name} to match`,
      );
    }
    case 'toHaveCSS': {
      const name = assertStringArg(args[0], 'toHaveCSS', 'a CSS property name');
      const expected = assertSerializedText(args[1], 'toHaveCSS');
      return callExpect(
        locator,
        'to.have.css',
        {
          isNot,
          timeout,
          expressionArg: name,
          expectedText: serializeExpectedText(expected),
        },
        `Expected CSS ${name} to match`,
      );
    }
    case 'toHaveJSProperty': {
      const name = assertStringArg(
        args[0],
        'toHaveJSProperty',
        'a property name',
      );
      const expectedValue = args[1];
      try {
        JSON.stringify(expectedValue);
      } catch {
        throw new Error(
          'toHaveJSProperty expects a JSON-serializable expected value',
        );
      }
      return callExpect(
        locator,
        'to.have.property',
        { isNot, timeout, expressionArg: name, expectedValue },
        `Expected JS property ${name} to match`,
      );
    }
  }

  throw new Error(`Unhandled expect matcher: ${method}`);
};

// ---------------------------------------------------------------------------
// Config dispatch
// ---------------------------------------------------------------------------

const dispatchConfigMethod = async (
  request: BrowserRpcRequest,
): Promise<null> => {
  switch (request.method) {
    case 'setTestIdAttribute': {
      const attr = request.args[0];
      if (typeof attr !== 'string' || !attr) {
        throw new Error(
          'setTestIdAttribute expects a non-empty string argument',
        );
      }
      const playwright = await import('playwright');
      playwright.selectors.setTestIdAttribute(attr);
      return null;
    }
    default:
      throw new Error(`Unknown config method: ${request.method}`);
  }
};

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function dispatchPlaywrightBrowserRpc({
  containerPage,
  runnerPage,
  request,
  timeoutFallbackMs,
}: {
  containerPage?: Page;
  runnerPage?: Page;
  request: BrowserRpcRequest;
  timeoutFallbackMs: number;
}): Promise<unknown> {
  // Config operations don't need a locator or runner frame.
  if (request.kind === 'config') {
    return dispatchConfigMethod(request);
  }

  const testPath = request.testPath;
  if (!testPath) {
    throw new Error('Browser RPC request is missing testPath');
  }

  const timeout =
    typeof request.timeout === 'number' ? request.timeout : timeoutFallbackMs;
  const requestDeadline = timeout > 0 ? Date.now() + timeout : undefined;

  let locatorRoot: FrameLocator | Page;
  let headedRunner: Awaited<ReturnType<typeof getRunnerFrame>> | undefined;
  if (runnerPage) {
    locatorRoot = runnerPage;
  } else {
    headedRunner = await getRunnerFrame(
      containerPage ??
        (() => {
          throw new Error('Browser container page is not initialized');
        })(),
      testPath,
      request.projectName,
      timeout > 0 ? timeout : 0,
    );
    locatorRoot = headedRunner.frame;
  }
  const locator = compilePlaywrightLocator(
    locatorRoot,
    request.locator as BrowserLocatorIR,
  );

  if (request.kind === 'screenshot') {
    if (!supportedScreenshotMatchers.has(request.method)) {
      throw new Error(`Screenshot matcher not supported: ${request.method}`);
    }
    const options = await readScreenshotOptions(locatorRoot, request.args[1]);
    let screenshotTarget: Locator | Page = locator;
    let restoreScreenshotState: (() => Promise<void>) | undefined;
    let beforeScreenshotCapture: (() => Promise<void>) | undefined;
    if (request.screenshotTarget === 'page') {
      if (runnerPage) {
        screenshotTarget = runnerPage;
      } else if (headedRunner) {
        const root = headedRunner.frame.locator(':root');
        if (options.fullPage === true) {
          const originalSize = await root.evaluate((element) => {
            const htmlElement = element as HTMLElement;
            return {
              width: htmlElement.style.width,
              height: htmlElement.style.height,
            };
          });
          beforeScreenshotCapture = async () => {
            await root.evaluate((element, size) => {
              const htmlElement = element as HTMLElement;
              htmlElement.style.width = size.width;
              htmlElement.style.height = size.height;
            }, originalSize);
            const styleTag =
              typeof options.style === 'string'
                ? await headedRunner.frame
                    .locator('head')
                    .evaluateHandle((head, content) => {
                      const style = document.createElement('style');
                      style.textContent = content;
                      head.appendChild(style);
                      return style;
                    }, options.style)
                : undefined;
            let scrollSize: { width: number; height: number };
            try {
              scrollSize = await root.evaluate((element) => ({
                width: element.scrollWidth,
                height: element.scrollHeight,
              }));
            } finally {
              await styleTag?.evaluate((element) => element.remove());
              await styleTag?.dispose();
            }
            await root.evaluate((element, size) => {
              const htmlElement = element as HTMLElement;
              htmlElement.style.width = `${size.width}px`;
              htmlElement.style.height = `${size.height}px`;
            }, scrollSize);
          };
          restoreScreenshotState = async () => {
            await root.evaluate((element, size) => {
              const htmlElement = element as HTMLElement;
              htmlElement.style.width = size.width;
              htmlElement.style.height = size.height;
            }, originalSize);
          };
        } else {
          screenshotTarget = headedRunner.iframe;
        }
        delete options.fullPage;
      } else {
        throw new Error(
          'Browser runner frame is not available for screenshot capture.',
        );
      }
    }
    if (request.screenshotTarget !== 'page' && options.fullPage !== undefined) {
      throw new Error(
        'toMatchScreenshot fullPage is only supported when asserting the page.',
      );
    }
    let screenshot: Buffer;
    try {
      screenshot = await captureStableScreenshot(
        screenshotTarget,
        options,
        requestDeadline,
        beforeScreenshotCapture,
      );
    } finally {
      await restoreScreenshotState?.();
    }
    return screenshot.toString('base64');
  }

  if (request.kind === 'locator') {
    if (!supportedLocatorActions.has(request.method)) {
      throw new Error(`Locator method not supported: ${request.method}`);
    }
    const target: any = locator as any;
    return await target[request.method](...request.args);
  }

  if (request.kind === 'expect') {
    if (!supportedExpectElementMatchers.has(request.method)) {
      throw new Error(`Expect matcher not supported: ${request.method}`);
    }
    return dispatchExpectMatcher(
      locator,
      request,
      !!request.isNot,
      normalizePlaywrightTimeout(timeout, request.timeoutIsExplicit === true),
    );
  }

  throw new Error(`Unknown browser rpc kind: ${request.kind}`);
}
