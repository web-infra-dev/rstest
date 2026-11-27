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

const serializeMatcherTextOrArray = (
  value: string | RegExp | readonly (string | RegExp)[],
): BrowserLocatorText | BrowserLocatorText[] => {
  return Array.isArray(value)
    ? value.map(serializeMatcherText)
    : serializeMatcherText(value as string | RegExp);
};

const pickDefinedOptions = (
  entries: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const result: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      result[key] = value;
      hasKeys = true;
    }
  }
  return hasKeys ? result : undefined;
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
    options?: Record<string, unknown>,
  ): Promise<void> => {
    const matcherOptions = options ? pickDefinedOptions(options) : undefined;
    await callBrowserRpc<void>({
      kind: 'expect',
      locator: locator.ir,
      method,
      args: matcherOptions ? [...args, matcherOptions] : args,
      isNot,
      timeout: getTimeout(timeout),
      timeoutIsExplicit: timeout !== undefined,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'projectName'>);
  };

  const api: Omit<BrowserElementExpect, 'not'> = {
    async toBeVisible(options) {
      await callExpect('toBeVisible', [], options?.timeout, {
        visible: options?.visible,
      });
    },
    async toBeHidden(options) {
      await callExpect('toBeHidden', [], options?.timeout);
    },
    async toBeEnabled(options) {
      await callExpect('toBeEnabled', [], options?.timeout, {
        enabled: options?.enabled,
      });
    },
    async toBeDisabled(options) {
      await callExpect('toBeDisabled', [], options?.timeout);
    },
    async toBeChecked(options) {
      await callExpect('toBeChecked', [], options?.timeout, {
        checked: options?.checked,
        indeterminate: options?.indeterminate,
      });
    },
    async toBeUnchecked(options) {
      await callExpect('toBeUnchecked', [], options?.timeout);
    },
    async toBeAttached(options) {
      await callExpect('toBeAttached', [], options?.timeout, {
        attached: options?.attached,
      });
    },
    async toBeDetached(options) {
      await callExpect('toBeDetached', [], options?.timeout);
    },
    async toBeEditable(options) {
      await callExpect('toBeEditable', [], options?.timeout, {
        editable: options?.editable,
      });
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
        [serializeMatcherTextOrArray(text)],
        options?.timeout,
        {
          ignoreCase: options?.ignoreCase,
          useInnerText: options?.useInnerText,
        },
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
        { ignoreCase: options?.ignoreCase },
      );
    },
    async toHaveAccessibleDescription(description, options) {
      await callExpect(
        'toHaveAccessibleDescription',
        [serializeMatcherText(description)],
        options?.timeout,
        { ignoreCase: options?.ignoreCase },
      );
    },
    async toContainText(text, options) {
      await callExpect(
        'toContainText',
        [serializeMatcherTextOrArray(text)],
        options?.timeout,
        {
          ignoreCase: options?.ignoreCase,
          useInnerText: options?.useInnerText,
        },
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
    async toHaveAttribute(
      name: string,
      valueOrOptions?: string | RegExp | { timeout?: number },
      maybeOptions?: { timeout?: number; ignoreCase?: boolean },
    ) {
      if (
        maybeOptions === undefined &&
        typeof valueOrOptions === 'object' &&
        valueOrOptions !== null &&
        !(valueOrOptions instanceof RegExp)
      ) {
        await callExpect('toHaveAttribute', [name], valueOrOptions.timeout);
        return;
      }
      if (valueOrOptions === undefined) {
        await callExpect('toHaveAttribute', [name], maybeOptions?.timeout);
        return;
      }
      await callExpect(
        'toHaveAttribute',
        [name, serializeMatcherText(valueOrOptions as string | RegExp)],
        maybeOptions?.timeout,
        { ignoreCase: maybeOptions?.ignoreCase },
      );
    },
    async toHaveClass(value, options) {
      await callExpect(
        'toHaveClass',
        [serializeMatcherTextOrArray(value)],
        options?.timeout,
      );
    },
    async toContainClass(value, options) {
      const isArray = Array.isArray(value);
      const items = isArray ? value : [value];
      if (items.some((item) => item instanceof RegExp)) {
        throw new TypeError(
          isArray
            ? '"expected" argument in toContainClass cannot contain RegExp values'
            : '"expected" argument in toContainClass cannot be a RegExp value',
        );
      }
      if (items.some((item) => typeof item !== 'string')) {
        throw new TypeError(
          'toContainClass expects a string or an array of strings',
        );
      }
      await callExpect('toContainClass', [value], options?.timeout);
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
    nameOrOptions?: string | ToMatchScreenshotOptions,
    screenshotOptions?: ToMatchScreenshotOptions,
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

    const [name, options] =
      typeof nameOrOptions === 'object'
        ? [undefined, nameOrOptions]
        : [nameOrOptions, screenshotOptions];
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
  LocatorAriaRole,
  LocatorBlurOptions,
  LocatorCheckOptions,
  LocatorClearOptions,
  LocatorClickOptions,
  LocatorDblclickOptions,
  LocatorDragToOptions,
  LocatorDispatchEventInit,
  LocatorDispatchEventOptions,
  LocatorFillOptions,
  LocatorFilterOptions,
  LocatorFocusOptions,
  LocatorGetByRoleOptions,
  LocatorHoverOptions,
  LocatorKeyboardModifier,
  LocatorMouseButton,
  LocatorOptions,
  LocatorPosition,
  LocatorPressOptions,
  LocatorScrollIntoViewIfNeededOptions,
  LocatorSelectOptionItem,
  LocatorSelectOptionOptions,
  LocatorSelectOptionValue,
  LocatorSetInputFilesOptions,
  LocatorTextOptions,
  LocatorWaitForOptions,
} from './locator';
export type {
  BrowserKeyboard,
  BrowserKeyboardPressOptions,
  BrowserKeyboardTabOptions,
} from './keyboard';
export { Locator, page, setTestIdAttribute };
