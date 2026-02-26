/**
 * Contains adapted logic from Playwright matchers:
 * https://github.com/microsoft/playwright/blob/main/packages/playwright/src/matchers/matchers.ts
 * Copyright (c) Microsoft Corporation, Apache-2.0.
 */
import type { FrameLocator, Locator, Page } from 'playwright';
import {
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

// ---------------------------------------------------------------------------
// Iframe lookup
// ---------------------------------------------------------------------------

const escapeCssAttrValue = (value: string): string => {
  // Minimal escaping for use in CSS attribute selectors with single quotes.
  // https://www.w3.org/TR/selectors-4/#attribute-representation
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const getRunnerFrame = async (
  containerPage: Page,
  testPath: string,
  timeoutMs: number,
): Promise<FrameLocator> => {
  const selector = `iframe[data-test-file='${escapeCssAttrValue(testPath)}']`;
  const iframe = containerPage.locator(selector);

  const count = await iframe.count();
  if (count === 0) {
    const known = await containerPage
      .locator('iframe[data-test-file]')
      .evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLIFrameElement).dataset.testFile),
      );
    throw new Error(
      `Runner iframe not found for testPath: ${JSON.stringify(testPath)}. ` +
        `Known iframes: ${JSON.stringify(known)}. ` +
        `Timeout: ${timeoutMs}ms`,
    );
  }

  return containerPage.frameLocator(selector);
};

// ---------------------------------------------------------------------------
// Table-driven expect matcher dispatch
// ---------------------------------------------------------------------------

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
  options: Record<string, unknown>,
  fallbackMessage: string,
): Promise<null> => {
  const result = await (locator as any)._expect(expectMethod, options);
  if (result.matches !== !options.isNot) {
    throw new Error(formatExpectError(result) || fallbackMessage);
  }
  return null;
};

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

  const locatorRoot = runnerPage
    ? runnerPage
    : await getRunnerFrame(
        containerPage ??
          (() => {
            throw new Error('Browser container page is not initialized');
          })(),
        testPath,
        timeout,
      );
  const locator = compilePlaywrightLocator(
    locatorRoot,
    request.locator as BrowserLocatorIR,
  );

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
    return dispatchExpectMatcher(locator, request, !!request.isNot, timeout);
  }

  throw new Error(`Unknown browser rpc kind: ${request.kind}`);
}
