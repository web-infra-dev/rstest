/**
 * Contains adapted logic from Playwright matchers:
 * https://github.com/microsoft/playwright/blob/main/packages/playwright/src/matchers/matchers.ts
 * Copyright (c) Microsoft Corporation, Apache-2.0.
 */
import type { FrameLocator, Page } from 'playwright';
import {
  supportedExpectElementMatchers,
  supportedLocatorActions,
} from '../../browserRpcRegistry';
import type { BrowserLocatorIR, BrowserRpcRequest } from '../../rpcProtocol';
import { compilePlaywrightLocator } from './compileLocator';
import { formatExpectError, serializeExpectedText } from './expectUtils';

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

    const isNot = !!request.isNot;

    switch (request.method) {
      case 'toBeVisible': {
        const result = await (locator as any)._expect('to.be.visible', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be visible',
          );
        }
        return null;
      }
      case 'toBeHidden': {
        const result = await (locator as any)._expect('to.be.hidden', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be hidden',
          );
        }
        return null;
      }
      case 'toBeEnabled': {
        const result = await (locator as any)._expect('to.be.enabled', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be enabled',
          );
        }
        return null;
      }
      case 'toBeDisabled': {
        const result = await (locator as any)._expect('to.be.disabled', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be disabled',
          );
        }
        return null;
      }
      case 'toBeAttached': {
        const result = await (locator as any)._expect('to.be.attached', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be attached',
          );
        }
        return null;
      }
      case 'toBeDetached': {
        const result = await (locator as any)._expect('to.be.detached', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be detached',
          );
        }
        return null;
      }
      case 'toBeEditable': {
        const result = await (locator as any)._expect('to.be.editable', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be editable',
          );
        }
        return null;
      }
      case 'toBeFocused': {
        const result = await (locator as any)._expect('to.be.focused', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be focused',
          );
        }
        return null;
      }
      case 'toBeEmpty': {
        const result = await (locator as any)._expect('to.be.empty', {
          isNot,
          timeout,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be empty',
          );
        }
        return null;
      }
      case 'toBeInViewport': {
        const ratio = request.args[0];
        if (ratio !== undefined && typeof ratio !== 'number') {
          throw new Error(
            `toBeInViewport expects ratio to be a number, got ${typeof ratio}`,
          );
        }
        const result = await (locator as any)._expect('to.be.in.viewport', {
          isNot,
          timeout,
          expectedNumber: ratio,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be in viewport',
          );
        }
        return null;
      }
      case 'toBeChecked': {
        const result = await (locator as any)._expect('to.be.checked', {
          isNot,
          timeout,
          expectedValue: { checked: true },
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be checked',
          );
        }
        return null;
      }
      case 'toBeUnchecked': {
        const result = await (locator as any)._expect('to.be.checked', {
          isNot,
          timeout,
          expectedValue: { checked: false },
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to be unchecked',
          );
        }
        return null;
      }
      case 'toHaveCount': {
        const expected = request.args[0];
        if (typeof expected !== 'number') {
          throw new Error(
            `toHaveCount expects a number, got ${typeof expected}`,
          );
        }
        const result = await (locator as any)._expect('to.have.count', {
          isNot,
          timeout,
          expectedNumber: expected,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || `Expected count ${expected}`,
          );
        }
        return null;
      }
      case 'toHaveId': {
        const expected = request.args[0] as any;
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveId expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.id', {
          isNot,
          timeout,
          expectedText: serializeExpectedText(expected),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to have id',
          );
        }
        return null;
      }
      case 'toHaveText': {
        const expected = request.args[0] as any;
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveText expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.text', {
          isNot,
          timeout,
          expectedText: serializeExpectedText(expected, {
            normalizeWhiteSpace: true,
          }),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to have text',
          );
        }
        return null;
      }
      case 'toContainText': {
        const expected = request.args[0] as any;
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toContainText expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.text', {
          isNot,
          timeout,
          expectedText: serializeExpectedText(expected, {
            matchSubstring: true,
            normalizeWhiteSpace: true,
          }),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to contain text',
          );
        }
        return null;
      }
      case 'toHaveValue': {
        const expected = request.args[0] as any;
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveValue expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.value', {
          isNot,
          timeout,
          expectedText: serializeExpectedText(expected),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to have value',
          );
        }
        return null;
      }
      case 'toHaveAttribute': {
        const name = request.args[0];
        if (typeof name !== 'string' || !name) {
          throw new Error('toHaveAttribute expects an attribute name');
        }

        const hasValue = request.args.length >= 2;
        const expected = hasValue ? (request.args[1] as any) : undefined;

        if (!hasValue) {
          const result = await (locator as any)._expect('to.have.attribute', {
            isNot,
            timeout,
            expressionArg: name,
          });
          if (result.matches !== !isNot) {
            throw new Error(
              formatExpectError(result) ||
                `Expected attribute ${name} to be present`,
            );
          }
          return null;
        }

        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveAttribute expects a serialized text matcher');
        }

        const result = await (locator as any)._expect(
          'to.have.attribute.value',
          {
            isNot,
            timeout,
            expressionArg: name,
            expectedText: serializeExpectedText(expected),
          },
        );
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || `Expected attribute ${name} to match`,
          );
        }
        return null;
      }
      case 'toHaveClass': {
        const expected = request.args[0] as any;
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveClass expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.class', {
          isNot,
          timeout,
          expectedText: serializeExpectedText(expected),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || 'Expected element to have class',
          );
        }
        return null;
      }
      case 'toHaveCSS': {
        const name = request.args[0];
        const expected = request.args[1] as any;
        if (typeof name !== 'string' || !name) {
          throw new Error('toHaveCSS expects a CSS property name');
        }
        if (
          !expected ||
          (expected.type !== 'string' && expected.type !== 'regexp')
        ) {
          throw new Error('toHaveCSS expects a serialized text matcher');
        }
        const result = await (locator as any)._expect('to.have.css', {
          isNot,
          timeout,
          expressionArg: name,
          expectedText: serializeExpectedText(expected),
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) || `Expected CSS ${name} to match`,
          );
        }
        return null;
      }
      case 'toHaveJSProperty': {
        const name = request.args[0];
        const expectedValue = request.args[1];
        if (typeof name !== 'string' || !name) {
          throw new Error('toHaveJSProperty expects a property name');
        }
        try {
          JSON.stringify(expectedValue);
        } catch {
          throw new Error(
            'toHaveJSProperty expects a JSON-serializable expected value',
          );
        }
        const result = await (locator as any)._expect('to.have.property', {
          isNot,
          timeout,
          expressionArg: name,
          expectedValue,
        });
        if (result.matches !== !isNot) {
          throw new Error(
            formatExpectError(result) ||
              `Expected JS property ${name} to match`,
          );
        }
        return null;
      }
    }
  }

  throw new Error(`Unknown browser rpc kind: ${request.kind}`);
}
