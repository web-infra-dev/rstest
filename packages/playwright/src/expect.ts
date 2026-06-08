import { expect as rstestExpect } from '@rstest/core';
import type { Assertion, ExpectStatic } from '@rstest/core';
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
  LocatorAssertions &
  PageAssertions;

export type PlaywrightExpect = Omit<ExpectStatic, 'soft'> & {
  <T>(actual: T, message?: string): PlaywrightAssertion<T>;
  soft: <T>(actual: T, message?: string) => PlaywrightAssertion<T>;
};

type RstestNotAssertion<T> = {
  readonly not: Assertion<T>;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
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

const matchesValue = (actual: unknown, expected: unknown) => {
  try {
    rstestExpect(actual).toEqual(expected);
    return true;
  } catch {
    return false;
  }
};

const getLocatorTextContent = async (locator: Locator) => {
  const texts = await getLocatorTextContents(locator);
  return texts.join('');
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

const assertExpectation = (
  pass: boolean,
  isNot: boolean,
  defaultMessage: string,
  customMessage?: string,
) => {
  const shouldThrow = isNot ? pass : !pass;
  if (!shouldThrow) {
    return;
  }
  throw new Error(
    customMessage ? `${customMessage}\n${defaultMessage}` : defaultMessage,
  );
};

const waitForExpectation = async (
  check: () => Promise<void>,
  options?: MatcherOptions,
) => {
  const timeout = options?.timeout ?? DEFAULT_EXPECT_TIMEOUT;
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start <= timeout) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await sleep(EXPECT_POLL_INTERVAL);
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
  message?: string,
): LocatorAssertions => ({
  get not() {
    return createLocatorAssertions(locator, !isNot, message);
  },

  async toBeVisible(options) {
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
      const actual = await getLocatorTextContent(locator);
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
    await waitForExpectation(async () => {
      const actual = await locator.getAttribute(name);
      const pass =
        expected === undefined
          ? actual !== null
          : actual !== null && matchesText(actual, expected, 'exact');
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
    await waitForExpectation(async () => {
      const actual = (await locator.getAttribute('class')) ?? '';
      const pass = matchesText(actual, expected, 'exact');
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
    await waitForExpectation(async () => {
      const actual = await locator.evaluate(
        (element, property) =>
          getComputedStyle(element).getPropertyValue(property),
        propertyName,
      );
      const pass = matchesText(actual, expected, 'exact');
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
      const actual = (await locator.getAttribute('id')) ?? '';
      const pass = matchesText(actual, expected, 'exact');
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
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
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

      const actual = await getLocatorTextContent(locator);
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
    await waitForExpectation(async () => {
      const actual = await locator.inputValue();
      const pass = matchesText(actual, expected, 'exact');
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
});

const createPageAssertions = (
  page: Page,
  isNot: boolean,
  message?: string,
): PageAssertions => ({
  get not() {
    return createPageAssertions(page, !isNot, message);
  },

  async toHaveTitle(expected, options) {
    await waitForExpectation(async () => {
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
    await waitForExpectation(async () => {
      const actual = page.url();
      const pass = matchesText(actual, expected, 'exact');
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
});

const createAssertion = <T>(
  actual: T,
  baseAssertion: Assertion<T>,
  isNot: boolean,
  message?: string,
): PlaywrightAssertion<T> => {
  const customAssertions = isLocator(actual)
    ? createLocatorAssertions(actual, isNot, message)
    : isPage(actual)
      ? createPageAssertions(actual, isNot, message)
      : undefined;

  if (!customAssertions) {
    return baseAssertion as PlaywrightAssertion<T>;
  }

  return new Proxy(baseAssertion as PlaywrightAssertion<T>, {
    get(target, key, receiver) {
      if (key === 'not') {
        // Rstest's public Assertion type narrows `not` through the upstream Chai type.
        const baseNot = (baseAssertion as unknown as RstestNotAssertion<T>).not;
        return createAssertion(actual, baseNot, !isNot, message);
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
    soft ? rstestExpect.soft(actual, message) : rstestExpect(actual, message),
    false,
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

    const value = Reflect.get(rstestExpect, key, receiver);
    return value ?? Reflect.get(target, key, receiver);
  },
  set(_target, key, value, receiver) {
    return Reflect.set(rstestExpect, key, value, receiver);
  },
}) as PlaywrightExpect;
