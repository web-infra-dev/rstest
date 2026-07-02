import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { expect as rstestExpect, rstest } from '@rstest/core';
import type { Assertion, ExpectStatic, RealTimers } from '@rstest/core';
import type { Locator, Page } from 'playwright';

const DEFAULT_EXPECT_TIMEOUT = 5000;
const EXPECT_POLL_INTERVAL = 50;

export type TextMatcher = string | RegExp;
export type TextExpectation = TextMatcher | TextMatcher[];

export type MatcherOptions = {
  /**
   * Time to retry the assertion in milliseconds.
   * @default 5000
   */
  timeout?: number;
};

export type InViewportOptions = MatcherOptions & {
  /**
   * Minimal visible ratio of the element in the viewport.
   */
  ratio?: number;
};

export type LocatorAssertions = {
  readonly not: LocatorAssertions;
  toBeVisible: (options?: MatcherOptions) => Promise<void>;
  toBeHidden: (options?: MatcherOptions) => Promise<void>;
  toBeEnabled: (options?: MatcherOptions) => Promise<void>;
  toBeDisabled: (options?: MatcherOptions) => Promise<void>;
  toBeChecked: (options?: MatcherOptions) => Promise<void>;
  toBeUnchecked: (options?: MatcherOptions) => Promise<void>;
  toBeAttached: (options?: MatcherOptions) => Promise<void>;
  toBeDetached: (options?: MatcherOptions) => Promise<void>;
  toBeEditable: (options?: MatcherOptions) => Promise<void>;
  toBeFocused: (options?: MatcherOptions) => Promise<void>;
  toBeEmpty: (options?: MatcherOptions) => Promise<void>;
  toBeInViewport: (options?: InViewportOptions) => Promise<void>;
  toContainText: (
    expected: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveAttribute: (
    name: string,
    expected?: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveClass: (
    expected: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveCSS: (
    propertyName: string,
    expected: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveCount: (expected: number, options?: MatcherOptions) => Promise<void>;
  toHaveId: (expected: TextMatcher, options?: MatcherOptions) => Promise<void>;
  toHaveJSProperty: (
    name: string,
    expected: unknown,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveText: (
    expected: TextExpectation,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveValue: (
    expected: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
};

export type PageAssertions = {
  readonly not: PageAssertions;
  toHaveTitle: (
    expected: TextMatcher,
    options?: MatcherOptions,
  ) => Promise<void>;
  toHaveURL: (expected: TextMatcher, options?: MatcherOptions) => Promise<void>;
};

export type PlaywrightAssertion<T> = Assertion<T> &
  (T extends Locator
    ? LocatorAssertions
    : T extends Page
      ? PageAssertions
      : object);

export type PlaywrightExpect = Omit<ExpectStatic, 'soft'> & {
  <T>(actual: T, message?: string): PlaywrightAssertion<T>;
  soft: <T>(actual: T, message?: string) => PlaywrightAssertion<T>;
};

type RstestNotAssertion<T> = {
  readonly not: Assertion<T>;
};

const expectStorage = new AsyncLocalStorage<() => ExpectStatic>();

export const withPlaywrightExpect = <T>(
  getExpect: () => ExpectStatic,
  fn: () => T,
): T => expectStorage.run(getExpect, fn);

const getRstestExpect = () => expectStorage.getStore()?.() ?? rstestExpect;

const bindExpectStaticMethod = <K extends keyof ExpectStatic>(key: K) => {
  const expect = getRstestExpect();
  return Reflect.get(expect, key);
};

const getRealNow = () => {
  try {
    return rstest.getRealSystemTime();
  } catch {
    return Date.now();
  }
};

const getRealTimers = (): RealTimers => {
  try {
    return rstest.getRealTimers();
  } catch {
    return {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setImmediate:
        typeof globalThis.setImmediate === 'function'
          ? globalThis.setImmediate.bind(globalThis)
          : undefined,
    };
  }
};

const waitForRealTime = (ms: number) =>
  new Promise<void>((resolve) => {
    getRealTimers().setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasFunction = <K extends string>(
  value: unknown,
  key: K,
): value is Record<K, (...args: never[]) => unknown> =>
  isRecord(value) && typeof value[key] === 'function';

const isLocator = (value: unknown): value is Locator =>
  hasFunction(value, 'count') &&
  hasFunction(value, 'evaluate') &&
  hasFunction(value, 'textContent');

const isPage = (value: unknown): value is Page =>
  hasFunction(value, 'goto') &&
  hasFunction(value, 'locator') &&
  hasFunction(value, 'title');

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const formatValue = (value: unknown) =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);

const matchesText = (
  actual: string,
  expected: TextMatcher,
  mode: 'exact' | 'contain',
) => {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }

  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);

  return mode === 'exact'
    ? normalizedActual === normalizedExpected
    : normalizedActual.includes(normalizedExpected);
};

const matchesRawText = (actual: string, expected: TextMatcher) => {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }

  return actual === expected;
};

const matchesValue = (actual: unknown, expected: unknown) =>
  isDeepStrictEqual(actual, expected);

const getStrictLocatorTextContent = async (locator: Locator) => {
  const count = await locator.count();

  if (count !== 1) {
    throw new Error(
      `Expected locator to resolve to 1 element, received ${count}.`,
    );
  }

  return locator.textContent().then((text) => text ?? '');
};

const getLocatorTextContents = (locator: Locator) =>
  locator.evaluateAll<string[]>((elements) => {
    const getDeepTextContent = (node: Node): string => {
      let text = '';

      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? '';
      }

      if (node instanceof Element && node.shadowRoot) {
        text += getDeepTextContent(node.shadowRoot);
      }

      for (const child of node.childNodes) {
        text += getDeepTextContent(child);
      }

      return text;
    };

    return elements.map((element) => getDeepTextContent(element));
  });

const getAssertionError = (
  pass: boolean,
  isNot: boolean,
  defaultMessage: string,
  customMessage?: string,
) => {
  const shouldThrow = isNot ? pass : !pass;
  if (!shouldThrow) {
    return;
  }

  return new Error(
    customMessage ? `${customMessage}\n${defaultMessage}` : defaultMessage,
  );
};

const assertExpectation = (
  pass: boolean,
  isNot: boolean,
  defaultMessage: string,
  customMessage?: string,
) => {
  const error = getAssertionError(pass, isNot, defaultMessage, customMessage);
  if (error) {
    throw error;
  }
};

const recordSoftFailure = (error: unknown, message?: string) => {
  const expect = getRstestExpect();
  const state = expect.getState();
  const assertionCalls = state.assertionCalls;
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  try {
    expect
      .soft(() => {
        throw normalizedError;
      }, message)
      .not.toThrow();
  } finally {
    expect.setState({ assertionCalls });
  }
};

const runPlaywrightAssertion = async (
  check: () => Promise<void>,
  soft: boolean,
  message?: string,
) => {
  try {
    await check();
  } catch (error) {
    if (!soft) {
      throw error;
    }

    recordSoftFailure(error, message);
  }
};

const createPlaywrightMatcher =
  (soft: boolean, message: string | undefined) =>
  (check: () => Promise<void>, options?: MatcherOptions) =>
    runPlaywrightAssertion(
      () => waitForExpectation(check, options),
      soft,
      message,
    );

const runWithTimeout = async (check: () => Promise<void>, timeout: number) => {
  const timers = getRealTimers();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timeoutId = timers.setTimeout(() => {
          reject(
            new Error(`Playwright assertion timed out after ${timeout}ms.`),
          );
        }, timeout);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      timers.clearTimeout(timeoutId);
    }
  }
};

const waitForExpectation = async (
  check: () => Promise<void>,
  options?: MatcherOptions,
) => {
  const timeout = options?.timeout ?? DEFAULT_EXPECT_TIMEOUT;
  const deadline = getRealNow() + timeout;
  let lastError: unknown;

  while (getRealNow() <= deadline) {
    try {
      await runWithTimeout(check, Math.max(deadline - getRealNow(), 0));
      return;
    } catch (error) {
      lastError = error;

      const remaining = deadline - getRealNow();
      if (remaining <= 0) {
        break;
      }

      await waitForRealTime(Math.min(EXPECT_POLL_INTERVAL, remaining));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError));
};

const createLocatorAssertions = (
  locator: Locator,
  isNot: boolean,
  soft: boolean,
  message?: string,
): LocatorAssertions => {
  const assert = createPlaywrightMatcher(soft, message);

  return {
    get not() {
      return createLocatorAssertions(locator, !isNot, soft, message);
    },

    async toBeVisible(options) {
      await assert(async () => {
        const pass = await locator.isVisible();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be visible.`,
          message,
        );
      }, options);
    },

    async toBeHidden(options) {
      await assert(async () => {
        const pass = await locator.isHidden();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be hidden.`,
          message,
        );
      }, options);
    },

    async toBeEnabled(options) {
      await assert(async () => {
        const pass = await locator.isEnabled();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be enabled.`,
          message,
        );
      }, options);
    },

    async toBeDisabled(options) {
      await assert(async () => {
        const pass = await locator.isDisabled();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be disabled.`,
          message,
        );
      }, options);
    },

    async toBeChecked(options) {
      await assert(async () => {
        const pass = await locator.isChecked();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be checked.`,
          message,
        );
      }, options);
    },

    async toBeUnchecked(options) {
      await assert(async () => {
        const pass = !(await locator.isChecked());
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be unchecked.`,
          message,
        );
      }, options);
    },

    async toBeAttached(options) {
      await assert(async () => {
        const count = await locator.count();
        const pass = count > 0;
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be attached, received count ${count}.`,
          message,
        );
      }, options);
    },

    async toBeDetached(options) {
      await assert(async () => {
        const count = await locator.count();
        const pass = count === 0;
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be detached, received count ${count}.`,
          message,
        );
      }, options);
    },

    async toBeEditable(options) {
      await assert(async () => {
        const pass = await locator.isEditable();
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be editable.`,
          message,
        );
      }, options);
    },

    async toBeFocused(options) {
      await assert(async () => {
        const pass = await locator.evaluate(
          (element) => element.ownerDocument.activeElement === element,
        );
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be focused.`,
          message,
        );
      }, options);
    },

    async toBeEmpty(options) {
      await assert(async () => {
        const pass = await locator.evaluate((element) => {
          if (
            typeof HTMLInputElement !== 'undefined' &&
            element instanceof HTMLInputElement
          ) {
            return element.value === '';
          }
          if (
            typeof HTMLTextAreaElement !== 'undefined' &&
            element instanceof HTMLTextAreaElement
          ) {
            return element.value === '';
          }
          return (
            element.children.length === 0 && (element.textContent ?? '') === ''
          );
        });
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be empty.`,
          message,
        );
      }, options);
    },

    async toBeInViewport(options) {
      await assert(async () => {
        const actualRatio = await locator.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const viewportWidth = globalThis.innerWidth;
          const viewportHeight = globalThis.innerHeight;
          const visibleWidth = Math.max(
            0,
            Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
          );
          const visibleHeight = Math.max(
            0,
            Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
          );
          const area = rect.width * rect.height;
          return area > 0 ? (visibleWidth * visibleHeight) / area : 0;
        });
        const expectedRatio = options?.ratio ?? Number.MIN_VALUE;
        const pass = actualRatio >= expectedRatio;
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to be in viewport, received ratio ${actualRatio}.`,
          message,
        );
      }, options);
    },

    async toContainText(expected, options) {
      await assert(async () => {
        const actual = await getStrictLocatorTextContent(locator);
        const pass = matchesText(actual, expected, 'contain');
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to contain text ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveAttribute(name, expected, options) {
      await assert(async () => {
        const actual = await locator.getAttribute(name);
        const pass =
          expected === undefined
            ? actual !== null
            : actual !== null && matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have attribute ${name}${
            expected === undefined ? '' : ` ${formatValue(expected)}`
          }, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveClass(expected, options) {
      await assert(async () => {
        const actual = (await locator.getAttribute('class')) ?? '';
        const pass = matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have class ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveCSS(propertyName, expected, options) {
      await assert(async () => {
        const actual = await locator.evaluate(
          (element, property) =>
            getComputedStyle(element).getPropertyValue(property),
          propertyName,
        );
        const pass = matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have CSS ${propertyName}: ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveCount(expected, options) {
      await assert(async () => {
        const actual = await locator.count();
        const pass = actual === expected;
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have count ${expected}, received ${actual}.`,
          message,
        );
      }, options);
    },

    async toHaveId(expected, options) {
      await assert(async () => {
        const actual = (await locator.getAttribute('id')) ?? '';
        const pass = matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have id ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveJSProperty(name, expected, options) {
      await assert(async () => {
        const actual = await locator.evaluate(
          (element, propertyName) =>
            (element as unknown as Record<string, unknown>)[propertyName],
          name,
        );
        const pass = matchesValue(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have JS property ${name}: ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveText(expected, options) {
      await assert(async () => {
        if (Array.isArray(expected)) {
          const actual = await getLocatorTextContents(locator);
          const pass =
            actual.length === expected.length &&
            actual.every((item, index) => {
              const expectedItem = expected[index];
              return expectedItem !== undefined
                ? matchesText(item, expectedItem, 'exact')
                : false;
            });
          assertExpectation(
            pass,
            isNot,
            `Expected locator ${isNot ? 'not ' : ''}to have text ${formatValue(
              expected,
            )}, received ${formatValue(actual)}.`,
            message,
          );
          return;
        }

        const actual = await getStrictLocatorTextContent(locator);
        const pass = matchesText(actual, expected, 'exact');
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have text ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveValue(expected, options) {
      await assert(async () => {
        const actual = await locator.inputValue();
        const pass = matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected locator ${isNot ? 'not ' : ''}to have value ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },
  };
};

const createPageAssertions = (
  page: Page,
  isNot: boolean,
  soft: boolean,
  message?: string,
): PageAssertions => {
  const assert = createPlaywrightMatcher(soft, message);

  return {
    get not() {
      return createPageAssertions(page, !isNot, soft, message);
    },

    async toHaveTitle(expected, options) {
      await assert(async () => {
        const actual = await page.title();
        const pass = matchesText(actual, expected, 'exact');
        assertExpectation(
          pass,
          isNot,
          `Expected page ${isNot ? 'not ' : ''}to have title ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },

    async toHaveURL(expected, options) {
      await assert(async () => {
        const actual = page.url();
        const pass = matchesRawText(actual, expected);
        assertExpectation(
          pass,
          isNot,
          `Expected page ${isNot ? 'not ' : ''}to have URL ${formatValue(
            expected,
          )}, received ${formatValue(actual)}.`,
          message,
        );
      }, options);
    },
  };
};

const createAssertion = <T>(
  actual: T,
  baseAssertion: Assertion<T>,
  isNot: boolean,
  soft: boolean,
  message?: string,
): PlaywrightAssertion<T> => {
  const customAssertions = isLocator(actual)
    ? createLocatorAssertions(actual, isNot, soft, message)
    : isPage(actual)
      ? createPageAssertions(actual, isNot, soft, message)
      : undefined;

  if (!customAssertions) {
    return baseAssertion as PlaywrightAssertion<T>;
  }

  return new Proxy(baseAssertion as PlaywrightAssertion<T>, {
    get(target, key, receiver) {
      if (key === 'not') {
        // Rstest's public Assertion type narrows `not` through the upstream Chai type.
        const baseNot = (baseAssertion as unknown as RstestNotAssertion<T>).not;
        return createAssertion(actual, baseNot, !isNot, soft, message);
      }

      if (key in customAssertions) {
        return Reflect.get(customAssertions, key, receiver);
      }

      return Reflect.get(target, key, receiver);
    },
  });
};

const createExpectAssertion = <T>(
  actual: T,
  message: string | undefined,
  soft: boolean,
) =>
  createAssertion(
    actual,
    soft
      ? getRstestExpect().soft(actual, message)
      : getRstestExpect()(actual, message),
    false,
    soft,
    message,
  );

const expectFn = (<T>(actual: T, message?: string) =>
  createExpectAssertion(actual, message, false)) as PlaywrightExpect;

const soft: PlaywrightExpect['soft'] = (actual, message) =>
  createExpectAssertion(actual, message, true);

export const expect = new Proxy(expectFn, {
  get(target, key, receiver) {
    if (key === 'soft') {
      return soft;
    }

    const value = bindExpectStaticMethod(key as keyof ExpectStatic);
    return value ?? Reflect.get(target, key, receiver);
  },
  set(_target, key, value, receiver) {
    return Reflect.set(getRstestExpect(), key, value, receiver);
  },
}) as PlaywrightExpect;
