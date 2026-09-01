import { registerElementExpect } from '@rstest/core/internal/browser-runtime';
import type { BrowserLocatorText, BrowserRpcRequest } from '../rpcProtocol';
import type { BrowserElementExpect } from './augmentExpect';
import { callBrowserRpc } from './browserRpc';
import {
  isLocator,
  Locator,
  page,
  serializeText,
  setTestIdAttribute,
} from './locator';

const serializeMatcherText = (value: string | RegExp): BrowserLocatorText => {
  return serializeText(value);
};

const createElementExpect = (
  locator: Locator,
  isNot: boolean,
  defaultTimeout: number,
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
      timeout: timeout ?? defaultTimeout,
    } satisfies Omit<BrowserRpcRequest, 'id' | 'testPath'>);
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

  const withNot = api as BrowserElementExpect;
  Object.defineProperty(withNot, 'not', {
    configurable: false,
    enumerable: false,
    get() {
      return createElementExpect(locator, !isNot, defaultTimeout);
    },
  });
  return withNot;
};

const element = (
  locator: unknown,
  options: { timeout: number },
): BrowserElementExpect => {
  if (!isLocator(locator)) {
    throw new TypeError(
      'expect.element() expects a Locator returned from @rstest/browser page.getBy* APIs.',
    );
  }

  return createElementExpect(locator, false, options.timeout);
};

registerElementExpect(element);

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
