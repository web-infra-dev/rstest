import { expect } from '@rstest/core';
import {
  getCurrentTestTimeout,
  registerElementExpect,
} from '@rstest/core/internal/browser-runtime';
import type {
  BrowserLocatorText,
  BrowserRpcRequest,
  ScreenshotMatchOutcome,
} from '../rpcProtocol';
import type { ToMatchScreenshotOptions } from './augmentExpect';
import type { BrowserElementExpect } from './augmentExpect';
import { callBrowserRpc } from './browserRpc';
import { isDomElement } from './elementLocator';
import {
  isLocator,
  isBrowserPage,
  Locator,
  page,
  serializeText,
  setTestIdAttribute,
} from './locator';

const serializeMatcherText = (value: string | RegExp): BrowserLocatorText => {
  return serializeText(value);
};

const screenshotAssertionCounts = new WeakMap<object, number>();

const createElementExpect = (
  locator: Locator,
  isNot: boolean,
  getTimeout: (timeout?: number) => number,
): BrowserElementExpect => {
  const callExpect = async (
    method: string,
    args: unknown[],
    timeout?: number,
  ): Promise<void> => {
    await callBrowserRpc<void>({
      kind: 'expect',
      locator: locator.ir,
      method,
      args,
      isNot,
      timeout: getTimeout(timeout),
      timeoutIsExplicit: timeout !== undefined,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'projectName'>);
  };

  const api: Omit<BrowserElementExpect, 'not'> = {
    async toBeVisible(options) {
      await callExpect('toBeVisible', [], options?.timeout);
    },
    async toBeHidden(options) {
      await callExpect('toBeHidden', [], options?.timeout);
    },
    async toBeEnabled(options) {
      await callExpect('toBeEnabled', [], options?.timeout);
    },
    async toBeDisabled(options) {
      await callExpect('toBeDisabled', [], options?.timeout);
    },
    async toBeChecked(options) {
      await callExpect('toBeChecked', [], options?.timeout);
    },
    async toBeUnchecked(options) {
      await callExpect('toBeUnchecked', [], options?.timeout);
    },
    async toBeAttached(options) {
      await callExpect('toBeAttached', [], options?.timeout);
    },
    async toBeDetached(options) {
      await callExpect('toBeDetached', [], options?.timeout);
    },
    async toBeEditable(options) {
      await callExpect('toBeEditable', [], options?.timeout);
    },
    async toBeFocused(options) {
      await callExpect('toBeFocused', [], options?.timeout);
    },
    async toBeEmpty(options) {
      await callExpect('toBeEmpty', [], options?.timeout);
    },
    async toBeInViewport(options) {
      const ratio = options?.ratio;
      await callExpect(
        'toBeInViewport',
        ratio === undefined ? [] : [ratio],
        options?.timeout,
      );
    },
    async toHaveText(text, options) {
      await callExpect(
        'toHaveText',
        [serializeMatcherText(text)],
        options?.timeout,
      );
    },
    async toHaveRole(role, options) {
      await callExpect(
        'toHaveRole',
        [serializeMatcherText(role)],
        options?.timeout,
      );
    },
    async toHaveAccessibleName(name, options) {
      await callExpect(
        'toHaveAccessibleName',
        [serializeMatcherText(name)],
        options?.timeout,
      );
    },
    async toHaveAccessibleDescription(description, options) {
      await callExpect(
        'toHaveAccessibleDescription',
        [serializeMatcherText(description)],
        options?.timeout,
      );
    },
    async toContainText(text, options) {
      await callExpect(
        'toContainText',
        [serializeMatcherText(text)],
        options?.timeout,
      );
    },
    async toHaveValue(value, options) {
      await callExpect(
        'toHaveValue',
        [serializeMatcherText(value)],
        options?.timeout,
      );
    },
    async toHaveValues(values, options) {
      await callExpect(
        'toHaveValues',
        [values.map(serializeMatcherText)],
        options?.timeout,
      );
    },
    async toHaveId(value, options) {
      await callExpect(
        'toHaveId',
        [serializeMatcherText(value)],
        options?.timeout,
      );
    },
    async toHaveAttribute(name, value, options) {
      const args =
        value === undefined ? [name] : [name, serializeMatcherText(value)];
      await callExpect('toHaveAttribute', args, options?.timeout);
    },
    async toHaveClass(value, options) {
      await callExpect(
        'toHaveClass',
        [serializeMatcherText(value)],
        options?.timeout,
      );
    },
    async toHaveCount(count, options) {
      await callExpect('toHaveCount', [count], options?.timeout);
    },
    async toHaveCSS(name, value, options) {
      if (typeof name !== 'string' || !name) {
        throw new TypeError('toHaveCSS expects a non-empty CSS property name');
      }
      await callExpect(
        'toHaveCSS',
        [name, serializeMatcherText(value)],
        options?.timeout,
      );
    },
    async toHaveJSProperty(name, value, options) {
      if (typeof name !== 'string' || !name) {
        throw new TypeError(
          'toHaveJSProperty expects a non-empty property name',
        );
      }
      await callExpect('toHaveJSProperty', [name, value], options?.timeout);
    },
  };

  const withNot = api as BrowserElementExpect;
  Object.defineProperty(withNot, 'not', {
    configurable: false,
    enumerable: false,
    get() {
      return createElementExpect(locator, !isNot, getTimeout);
    },
  });
  return withNot;
};

const element = (
  target: unknown,
  options: { getTimeout: () => number },
): BrowserElementExpect => {
  const locator = isDomElement(target) ? page.elementLocator(target) : target;
  if (!isLocator(locator)) {
    throw new TypeError(
      'expect.element() expects an Rstest Locator or a DOM Element from the current test document.',
    );
  }

  return createElementExpect(locator, false, options.getTimeout);
};

registerElementExpect(element);

expect.extend({
  async toMatchScreenshot(
    received: unknown,
    name?: string,
    options?: ToMatchScreenshotOptions,
  ) {
    if (this.isNot) {
      throw new Error('toMatchScreenshot() does not support .not.');
    }
    const receivedLocator = isLocator(received) ? received : undefined;
    const isPageScreenshot = isBrowserPage(received);
    if (!receivedLocator && !isPageScreenshot) {
      throw new TypeError(
        'toMatchScreenshot() expects a Locator or page from @rstest/browser.',
      );
    }

    const assertion = Reflect.get(this, 'assertion');
    const hasAssertionFlag = (flag: string): boolean =>
      Object.prototype.hasOwnProperty.call(assertion, flag) &&
      Reflect.get(assertion, flag) === true;
    const isConcurrentTest =
      hasAssertionFlag('rstestCurrentTestConcurrent') ||
      Reflect.get(this, 'rstestCurrentTestConcurrent') === true;
    const testCase = Object.prototype.hasOwnProperty.call(
      assertion,
      'rstestTestCase',
    )
      ? Reflect.get(assertion, 'rstestTestCase')
      : undefined;
    const defaultName = this.currentTestName;
    const screenshotName =
      name ??
      (isConcurrentTest && !hasAssertionFlag('rstestTestScoped')
        ? undefined
        : testCase && defaultName
          ? `${defaultName}${testCase.screenshotNameSuffix ?? ''}`
          : defaultName);
    if (!screenshotName) {
      throw new Error(
        'toMatchScreenshot() must be called inside a non-concurrent test or given a name.',
      );
    }

    let screenshotAssertionOrdinal: number | undefined;
    if (name === undefined) {
      const isTestScoped =
        testCase && (!isConcurrentTest || hasAssertionFlag('rstestTestScoped'));
      if (isTestScoped) {
        const attemptContext = Reflect.get(testCase, 'context');
        const attemptSignal = Reflect.get(attemptContext, 'signal');
        const assertionOwner =
          attemptSignal && typeof attemptSignal === 'object'
            ? attemptSignal
            : testCase;
        const previousCount =
          screenshotAssertionCounts.get(assertionOwner) ?? 0;
        screenshotAssertionCounts.set(assertionOwner, previousCount + 1);
        screenshotAssertionOrdinal = previousCount + 1;
      }
    }

    const mask = options?.mask ?? [];
    if (!mask.every(isLocator)) {
      throw new TypeError(
        'toMatchScreenshot mask must contain browser-mode Locators.',
      );
    }
    const { mask: _mask, ...serializedOptions } = options ?? {};

    await callBrowserRpc<ScreenshotMatchOutcome>({
      kind: 'screenshot',
      locator: receivedLocator?.ir ?? { steps: [] },
      method: 'toMatchScreenshot',
      ...(isPageScreenshot ? { screenshotTarget: 'page' as const } : {}),
      timeout: getCurrentTestTimeout(
        isConcurrentTest && !hasAssertionFlag('rstestTestScoped')
          ? undefined
          : testCase,
      ),
      snapshotUpdate:
        window.__RSTEST_BROWSER_OPTIONS__?.snapshot.updateSnapshot,
      args: [
        screenshotName,
        { ...serializedOptions, mask: mask.map((item) => item.ir) },
        ...(screenshotAssertionOrdinal === undefined
          ? []
          : [screenshotAssertionOrdinal]),
      ],
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'projectName'>);

    return { pass: true, message: () => '' };
  },
});

export type {
  BrowserPage,
  BrowserSerializable,
  LocatorBlurOptions,
  LocatorCheckOptions,
  LocatorClickOptions,
  LocatorDblclickOptions,
  LocatorDragToOptions,
  LocatorDispatchEventInit,
  LocatorFillOptions,
  LocatorFilterOptions,
  LocatorFocusOptions,
  LocatorGetByRoleOptions,
  LocatorHoverOptions,
  LocatorKeyboardModifier,
  LocatorMouseButton,
  LocatorPosition,
  LocatorPressOptions,
  LocatorScrollIntoViewIfNeededOptions,
  LocatorSelectOptionOptions,
  LocatorSetInputFilesOptions,
  LocatorTextOptions,
  LocatorWaitForOptions,
} from './locator';
export { Locator, page, setTestIdAttribute };
