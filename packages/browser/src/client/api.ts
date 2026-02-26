import type { BrowserLocatorText, BrowserRpcRequest } from '../rpcProtocol';
import { callBrowserRpc } from './browserRpc';
import {
  isLocator,
  Locator,
  page,
  serializeText,
  setTestIdAttribute,
} from './locator';

type ElementExpect = {
  not: ElementExpect;
  toBeVisible: (options?: { timeout?: number }) => Promise<void>;
  toBeHidden: (options?: { timeout?: number }) => Promise<void>;
  toBeEnabled: (options?: { timeout?: number }) => Promise<void>;
  toBeDisabled: (options?: { timeout?: number }) => Promise<void>;
  toBeChecked: (options?: { timeout?: number }) => Promise<void>;
  toBeUnchecked: (options?: { timeout?: number }) => Promise<void>;
  toBeAttached: (options?: { timeout?: number }) => Promise<void>;
  toBeDetached: (options?: { timeout?: number }) => Promise<void>;
  toBeEditable: (options?: { timeout?: number }) => Promise<void>;
  toBeFocused: (options?: { timeout?: number }) => Promise<void>;
  toBeEmpty: (options?: { timeout?: number }) => Promise<void>;
  toBeInViewport: (options?: {
    timeout?: number;
    ratio?: number;
  }) => Promise<void>;
  toHaveText: (
    text: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toContainText: (
    text: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveValue: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveId: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveAttribute: (
    name: string,
    value?: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveClass: (
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveCount: (count: number, options?: { timeout?: number }) => Promise<void>;
  toHaveCSS: (
    name: string,
    value: string | RegExp,
    options?: { timeout?: number },
  ) => Promise<void>;
  toHaveJSProperty: (
    name: string,
    value: unknown,
    options?: { timeout?: number },
  ) => Promise<void>;
};

const serializeMatcherText = (value: string | RegExp): BrowserLocatorText => {
  return serializeText(value);
};

const createElementExpect = (
  locator: Locator,
  isNot: boolean,
): ElementExpect => {
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
      timeout,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath' | 'runId'>);
  };

  const api: Omit<ElementExpect, 'not'> = {
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

  const withNot = api as ElementExpect;
  Object.defineProperty(withNot, 'not', {
    configurable: false,
    enumerable: false,
    get() {
      return createElementExpect(locator, !isNot);
    },
  });
  return withNot;
};

const element = (locator: unknown): ElementExpect => {
  if (!isLocator(locator)) {
    throw new TypeError(
      'expect.element() expects a Locator returned from @rstest/browser page.getBy* APIs.',
    );
  }

  return createElementExpect(locator, false);
};

const markBrowserElement = (): void => {
  Object.defineProperty(element, '__rstestBrowser', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
};

const installExpectElement = (): void => {
  // In browser runtime, `@rstest/core` exports are proxies that forward property
  // access to `globalThis.RSTEST_API`. Patch the underlying expect implementation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (globalThis as any).RSTEST_API as any;
  const target = api?.expect;
  if (!target) {
    throw new Error(
      'RSTEST_API.expect is not registered yet. This usually indicates @rstest/browser was imported too early.',
    );
  }

  if (typeof target.element !== 'function' || !target.element.__rstestBrowser) {
    markBrowserElement();
    target.element = element;
  }
};

installExpectElement();

export type {
  BrowserPage,
  BrowserSerializable,
  LocatorBlurOptions,
  LocatorCheckOptions,
  LocatorClickOptions,
  LocatorDblclickOptions,
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
