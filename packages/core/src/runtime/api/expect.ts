/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/integrations/chai/poll.ts
 *
 * MIT License
 *
 * Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

import {
  ASYMMETRIC_MATCHERS_OBJECT,
  addCustomEqualityTesters,
  arrayBufferEquality,
  ChaiStyleAssertions,
  type ChaiPlugin,
  customMatchers,
  equals,
  GLOBAL_EXPECT,
  getState,
  iterableEquality,
  JEST_MATCHERS_OBJECT,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
  setState,
  sparseArrayEquality,
  typeEquality,
  type Tester,
  wrapAssertion,
} from '@vitest/expect';
import {
  assert,
  config as chaiConfig,
  expect as chaiExpect,
  use,
  util,
} from 'chai';
import type {
  Assertion,
  ChaiConfig,
  MatcherState,
  MockInstance,
  RstestExpect,
  TestCase,
  TestSuite,
  WorkerState,
} from '../../types';
import { DEFAULT_EXPECT_POLL_TIMEOUT } from '../../utils/constants';
import { toNativePath } from '../../utils/helper';
import { fileContext } from '../fileContext';
import { createExpectPoll } from './poll';
import { getRemainingTestTimeout, TEST_TIMEOUT_BUFFER } from './timeout';

export { assert } from 'chai';

const defaultChaiConfig: ChaiConfig = {
  showDiff: chaiConfig.showDiff,
  truncateThreshold: chaiConfig.truncateThreshold,
};

const ANY_PRIMITIVE_CONSTRUCTOR_NAMES = [
  'String',
  'Number',
  'Function',
  'Boolean',
  'BigInt',
  'Symbol',
  'Object',
] as const;

export function setupChaiConfig(config: ChaiConfig = {}): void {
  Object.assign(chaiConfig, defaultChaiConfig, config);
}

const EXPECT_BOOKKEEPING_STATE = {
  assertionCalls: 0,
  isExpectingAssertions: false,
  isExpectingAssertionsError: null,
  expectedAssertionsNumber: null,
  expectedAssertionsNumberErrorGen: null,
} satisfies Partial<MatcherState>;

export const resetExpectState = (
  expect: RstestExpect,
  state: Partial<MatcherState>,
): void => {
  setState<MatcherState>(EXPECT_BOOKKEEPING_STATE, expect);
  // Keep this separate from the bookkeeping reset: setState preserves getters
  // such as the file-level testPath binding, while object spread would not.
  setState<MatcherState>(state, expect);
};

/**
 * The runner pins `testPath` to a plain value per test, so each file must
 * restore this live getter.
 */
const fileExpectState = (
  getWorkerState: () => WorkerState,
): Partial<MatcherState> => ({
  // `testPath` is user-facing; expose the OS-native path (equal to
  // `import.meta.filename`) for every expect instance — global and the
  // public per-test `context.expect` alike. Internally it stays POSIX (#1465).
  get testPath() {
    return toNativePath(getWorkerState().testPath);
  },
});

type GlobalWithExpect = typeof globalThis & {
  [GLOBAL_EXPECT]: RstestExpect;
};

export const getGlobalExpect = (): RstestExpect =>
  (globalThis as GlobalWithExpect)[GLOBAL_EXPECT];

type ElementExpectHandler = (
  locator: unknown,
  options: { getTimeout: (timeout?: number) => number },
) => unknown;

let elementExpectHandler: ElementExpectHandler | undefined;

export const registerElementExpect = (handler: ElementExpectHandler): void => {
  elementExpectHandler = handler;
};

// Vitest 4.1 types `returned(value)`, while its runtime also accepts no arguments.
const ReturnedAlias: ChaiPlugin = (chai, utils) => {
  utils.overwriteMethod(chai.Assertion.prototype, 'returned', () => {
    return function (this: Assertion, expected?: unknown) {
      return arguments.length === 0
        ? this.toHaveReturned()
        : this.toHaveReturnedWith(expected);
    };
  });
};

type ChaiThrowAssertion = Assertion & {
  throws: (expected?: RegExp | string) => unknown;
};

const CrossRealmToThrow: ChaiPlugin = (chai, utils) => {
  const overwrite = (_super: (expected?: unknown) => unknown) => {
    return function (this: ChaiThrowAssertion, expected?: unknown) {
      const isPromiseAssertion = Boolean(utils.flag(this, 'promise'));
      const isRegExp =
        expected !== null &&
        typeof expected === 'object' &&
        Object.prototype.toString.call(expected) === '[object RegExp]';

      // `@vitest/expect` uses `instanceof RegExp` before delegating to Chai.
      // A regexp literal created in a vm.Context is not an instance of the
      // host realm's RegExp, so preserve Vitest's toThrow semantics across
      // realms by using Chai's cross-realm-safe `throws` implementation for
      // synchronous function assertions. Promise assertions must stay on
      // Vitest's promise-aware path because their target is the rejection
      // value, not a callable function.
      if (isRegExp && !isPromiseAssertion) {
        return this.throws(expected as RegExp);
      }

      // Keep a cross-realm regexp usable by Vitest's promise-aware matcher.
      // Vitest recognizes host RegExp instances before it handles `.rejects`.
      if (isRegExp && !(expected instanceof RegExp)) {
        const regexp = expected as RegExp;
        return _super.call(this, new RegExp(regexp.source, regexp.flags));
      }

      return _super.call(this, expected);
    };
  };

  utils.overwriteMethod(chai.Assertion.prototype, 'toThrow', overwrite);
  utils.overwriteMethod(chai.Assertion.prototype, 'toThrowError', overwrite);
};

const isNativeFunction = (fn: unknown): boolean =>
  typeof fn === 'function' &&
  Function.prototype.toString.call(fn).includes('[native code]');

// `typeEquality` compares constructors, which differ across realms: host APIs
// such as `URLSearchParams#getAll()` and `TextEncoder#encodeInto()` return
// values built with host constructors. Like Jest, treat two arrays, or two
// native built-ins with the same constructor name, as the same type. User
// classes still need identity.
// https://github.com/jestjs/jest/issues/2549
// https://github.com/jestjs/jest/pull/15959
const crossRealmTypeEquality: typeof typeEquality = (a, b) =>
  (Array.isArray(a) && Array.isArray(b)) ||
  (a?.constructor?.name === b?.constructor?.name &&
    isNativeFunction(a?.constructor) &&
    isNativeFunction(b?.constructor))
    ? undefined
    : typeEquality(a, b);

const getArrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;

const dataViewDescriptors = Object.getOwnPropertyDescriptors(
  DataView.prototype,
);
const getDataViewBuffer = dataViewDescriptors.buffer!.get!;
const getDataViewByteOffset = dataViewDescriptors.byteOffset!.get!;
const getDataViewByteLength = dataViewDescriptors.byteLength!.get!;

const toLocalDataView = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Intrinsic getters check brands across realms without trusting user-defined
  // tags or shadowed buffer/offset/length properties. Non-binary values fall through.
  try {
    // `in` avoids property getters but can invoke a throwing Proxy has trap.
    // A user-defined byteLength still needs to pass intrinsic brand validation.
    if (!('byteLength' in value)) {
      return value;
    }
    if (ArrayBuffer.isView(value)) {
      return new DataView(
        getDataViewBuffer.call(value),
        getDataViewByteOffset.call(value),
        getDataViewByteLength.call(value),
      );
    }
    getArrayBufferByteLength.call(value);
    // The intrinsic getter establishes the buffer type across realms.
    return new DataView(value as ArrayBuffer);
  } catch {
    return value;
  }
};

// The upstream tester uses instanceof; local views preserve byte ranges without
// copying bytes or changing the prototypes of values owned by the test.
const crossRealmArrayBufferEquality: typeof arrayBufferEquality = (a, b) =>
  arrayBufferEquality(toLocalDataView(a), toLocalDataView(b));

// Keep in sync with `toStrictEqual` in `@vitest/expect`'s `JestChaiExpect`.
const CrossRealmToStrictEqual: ChaiPlugin = (chai, utils) => {
  const { customEqualityTesters, matchers } = (globalThis as any)[
    JEST_MATCHERS_OBJECT
  ];
  const toStrictEqual = wrapAssertion(
    utils,
    'toStrictEqual',
    function (expected: unknown) {
      const actual = utils.flag(this, 'object');
      const pass = equals(
        actual,
        expected,
        [
          ...customEqualityTesters,
          iterableEquality,
          crossRealmTypeEquality,
          sparseArrayEquality,
          crossRealmArrayBufferEquality,
        ],
        true,
      );
      return this.assert(
        pass,
        'expected #{this} to strictly equal #{exp}',
        'expected #{this} to not strictly equal #{exp}',
        expected,
        actual,
      );
    },
  );
  utils.addMethod(chai.Assertion.prototype, 'toStrictEqual', toStrictEqual);
  utils.addMethod(matchers, 'toStrictEqual', toStrictEqual);
};

type VitestChaiMatcher = (
  this: Chai.Assertion,
  ...args: unknown[]
) => void | PromiseLike<void>;

type JestMatcherRegistry = {
  customEqualityTesters: Tester[];
  matchers: {
    toHaveBeenCalledWith: VitestChaiMatcher;
    toBeCalledWith: VitestChaiMatcher;
    toHaveBeenCalledExactlyOnceWith: VitestChaiMatcher;
    toHaveBeenLastCalledWith: VitestChaiMatcher;
    toHaveBeenNthCalledWith: VitestChaiMatcher;
    toContain: VitestChaiMatcher;
  };
};

const isMockInstance = (value: unknown): value is MockInstance =>
  (typeof value === 'function' || typeof value === 'object') &&
  value !== null &&
  '_isMockFunction' in value &&
  value._isMockFunction === true;

const LazyMatcherMessages: ChaiPlugin = (chai, utils) => {
  const registry = (globalThis as Record<symbol, unknown>)[
    JEST_MATCHERS_OBJECT
  ] as JestMatcherRegistry;

  for (const matcherName of [
    'toHaveBeenCalledWith',
    'toBeCalledWith',
    'toHaveBeenCalledExactlyOnceWith',
    'toHaveBeenLastCalledWith',
    'toHaveBeenNthCalledWith',
  ] as const) {
    const originalMatcher = registry.matchers[matcherName];
    const matcher = wrapAssertion(utils, matcherName, function (...args) {
      const mock = utils.flag(this, 'object');
      if (!isMockInstance(mock)) {
        return originalMatcher.apply(this, args);
      }

      const calls = mock.mock.calls;
      const spyName = mock.getMockName();
      const customTesters = [
        ...registry.customEqualityTesters,
        iterableEquality,
      ];
      const equalsArguments = (
        callArgs: unknown[],
        expectedArgs: unknown[],
      ) => {
        for (const tester of registry.customEqualityTesters) {
          const result = tester.call(
            { equals },
            callArgs,
            expectedArgs,
            customTesters,
          );
          if (result !== undefined) {
            return result;
          }
        }

        return (
          callArgs.length === expectedArgs.length &&
          callArgs.every((callArg, index) =>
            equals(callArg, expectedArgs[index], customTesters),
          )
        );
      };

      let pass: boolean;
      let expectedArgs = args;
      let actual: unknown = calls;
      let showDiff = false;
      let positiveMessage: string;
      let negativeMessage: string;

      switch (matcherName) {
        case 'toHaveBeenCalledWith':
        case 'toBeCalledWith':
          pass = calls.some((callArgs) => equalsArguments(callArgs, args));
          positiveMessage = `expected "${spyName}" to be called with arguments: #{exp}, but got #{act}`;
          negativeMessage = `expected "${spyName}" to not be called with arguments: #{exp}`;
          break;
        case 'toHaveBeenCalledExactlyOnceWith':
          {
            const onlyCall = calls.length === 1 ? calls[0] : undefined;
            pass = onlyCall !== undefined && equalsArguments(onlyCall, args);
          }
          positiveMessage = `expected "${spyName}" to be called once with arguments: #{exp}, but got #{act}`;
          negativeMessage = `expected "${spyName}" to not be called once with arguments: #{exp}`;
          break;
        case 'toHaveBeenLastCalledWith': {
          const lastCall = calls.at(-1);
          pass = Boolean(lastCall && equalsArguments(lastCall, args));
          actual = lastCall;
          positiveMessage = `expected last "${spyName}" call to have been called with #{exp}, but got #{act}`;
          negativeMessage = `expected last "${spyName}" call to not have been called with #{exp}`;
          break;
        }
        case 'toHaveBeenNthCalledWith': {
          const [times, ...nthArgs] = args;
          if (!Number.isSafeInteger(times) || (times as number) < 1) {
            throw new Error('n must be a positive integer');
          }
          const nthCall = calls[(times as number) - 1];
          const isCalled = (times as number) <= calls.length;
          pass = Boolean(nthCall && equalsArguments(nthCall, nthArgs));
          expectedArgs = nthArgs;
          actual = nthCall;
          showDiff = isCalled;
          positiveMessage = `expected ${String(times)} call of "${spyName}" to have been called with #{exp}${isCalled ? ', but got #{act}' : `, but called only ${calls.length} times`}`;
          negativeMessage = `expected ${String(times)} call of "${spyName}" to not have been called with #{exp}`;
          break;
        }
      }

      return this.assert(
        pass,
        positiveMessage,
        negativeMessage,
        expectedArgs,
        actual,
        showDiff,
      );
    });

    utils.addMethod(chai.Assertion.prototype, matcherName, matcher);
    utils.addMethod(registry.matchers, matcherName, matcher);
  }

  const originalToContain = registry.matchers.toContain;
  const toContain = wrapAssertion(utils, 'toContain', function (item) {
    const actual = utils.flag(this, 'object');

    if (typeof Node !== 'undefined' && actual instanceof Node) {
      if (!(item instanceof Node)) {
        return originalToContain.call(this, item);
      }

      return this.assert(
        actual.contains(item),
        'expected #{this} to contain element #{exp}',
        'expected #{this} not to contain element #{exp}',
        item,
        actual,
      );
    }

    if (typeof DOMTokenList !== 'undefined' && actual instanceof DOMTokenList) {
      if (typeof item !== 'string') {
        return originalToContain.call(this, item);
      }

      return this.assert(
        actual.contains(item),
        `expected "${actual.value}" to contain "${item}"`,
        `expected "${actual.value}" not to contain "${item}"`,
        item,
        actual.value,
      );
    }

    if (typeof actual === 'string') {
      return this.assert(
        actual.includes(item as string),
        'expected #{this} to contain #{exp}',
        'expected #{this} not to contain #{exp}',
        item,
        actual,
      );
    }

    if (actual == null) {
      return originalToContain.call(this, item);
    }

    const actualValues = Array.from(actual as Iterable<unknown>);
    utils.flag(this, 'object', actualValues);
    return this.assert(
      actualValues.includes(item),
      'expected #{this} to include #{exp}',
      'expected #{this} to not include #{exp}',
      item,
      actualValues,
    );
  });

  utils.addMethod(chai.Assertion.prototype, 'toContain', toContain);
  utils.addMethod(registry.matchers, 'toContain', toContain);
};

// These plugins mutate Chai's process-level prototype, not an expect instance.
use(JestExtend);
use(JestChaiExpect);
use(ChaiStyleAssertions);
use(ReturnedAlias);
use(CrossRealmToThrow);
use(CrossRealmToStrictEqual);
use(JestAsymmetricMatchers);
use(LazyMatcherMessages);

export function createExpect({
  getCurrentTest,
  getElementTest,
  getWorkerState,
  snapshotPlugin,
}: {
  /**
   * Resolved at call time, never captured: the file-level singleton passes a
   * context-resolving accessor so a reference shared across files under
   * `isolate: false` always reads the running file's state; a per-test local
   * expect passes its own pinned state.
   */
  getWorkerState: () => WorkerState;
  getCurrentTest: () => TestCase | undefined;
  getElementTest?: () => TestCase | TestSuite | undefined;
  snapshotPlugin?: ChaiPlugin;
}): RstestExpect {
  if (snapshotPlugin) {
    use(snapshotPlugin);
  }

  const expect = ((value: any, message?: string): Assertion => {
    const { assertionCalls } = getState(expect);
    setState({ assertionCalls: assertionCalls + 1 }, expect);
    const assert = chaiExpect(value, message) as unknown as Assertion;
    const _test = getCurrentTest();
    if (_test) {
      // @ts-expect-error internal
      return assert.withTest(_test) as Assertion;
    }
    return assert;
  }) as RstestExpect;
  Object.assign(expect, chaiExpect);
  Object.assign(expect, (globalThis as any)[ASYMMETRIC_MATCHERS_OBJECT]);

  const any = expect.any;
  expect.any = (constructor) => {
    const runtimeGlobal = fileContext().runtimeGlobal;
    for (const name of ANY_PRIMITIVE_CONSTRUCTOR_NAMES) {
      if (constructor === runtimeGlobal?.[name]) {
        const matcher = Reflect.apply(any, expect, [globalThis[name]]);
        if (name === 'Function' || name === 'Object') {
          return matcher;
        }
        const asymmetricMatch = matcher.asymmetricMatch.bind(matcher);
        matcher.asymmetricMatch = (value: unknown) =>
          asymmetricMatch(value) ||
          Reflect.apply(Function.prototype[Symbol.hasInstance], constructor, [
            value,
          ]);
        return matcher;
      }
    }
    return Reflect.apply(any, expect, [constructor]);
  };

  expect.getState = () => getState<MatcherState>(expect);
  expect.setState = (state) => setState(state, expect);

  const globalState = getState((globalThis as any)[GLOBAL_EXPECT]) || {};

  setState<MatcherState>({ ...globalState }, expect);
  resetExpectState(expect, fileExpectState(getWorkerState));

  // @ts-expect-error chai.expect.extend untyped
  expect.extend = (matchers) => chaiExpect.extend(expect, matchers);
  expect.addEqualityTesters = (customTesters) =>
    addCustomEqualityTesters(customTesters);

  expect.soft = (...args) => {
    // @ts-expect-error private soft access
    return expect(...args).withContext({ soft: true }) as Assertion;
  };

  expect.poll = createExpectPoll(
    expect,
    () => getWorkerState().runtimeConfig.expect.poll,
    () => {
      if (getElementTest) {
        const timeoutContext = getElementTest();
        return timeoutContext?.type === 'case' ? timeoutContext : undefined;
      }
      return getCurrentTest();
    },
  );

  const element = (locator: unknown): unknown => {
    if (!elementExpectHandler) {
      throw new Error(
        'expect.element() is only available in browser mode. ' +
          'Enable browser mode in config and import @rstest/browser to install the browser expect adapter.',
      );
    }

    const getTimeout = (timeout?: number): number => {
      const currentTest = getElementTest ? getElementTest() : getCurrentTest();
      const pollTimeout =
        getWorkerState().runtimeConfig.expect?.poll?.timeout ??
        DEFAULT_EXPECT_POLL_TIMEOUT;
      const remainingTestTimeout = currentTest
        ? getRemainingTestTimeout(currentTest, TEST_TIMEOUT_BUFFER)
        : undefined;
      const configuredTimeout =
        timeout === 0 && remainingTestTimeout !== undefined
          ? remainingTestTimeout
          : (timeout ?? pollTimeout);
      return remainingTestTimeout === undefined
        ? configuredTimeout
        : Math.min(configuredTimeout, remainingTestTimeout);
    };
    const assertion = elementExpectHandler(locator, { getTimeout });
    const { assertionCalls } = getState(expect);
    setState({ assertionCalls: assertionCalls + 1 }, expect);
    return assertion;
  };
  Object.assign(expect, { element });

  expect.unreachable = (message?: string) => {
    assert.fail(`expected ${message ? `"${message}" ` : ''}not to be reached`);
  };

  function assertions(expected: number) {
    const errorGen = () =>
      new Error(
        `expected number of assertions to be ${expected}, but got ${
          expect.getState().assertionCalls
        }`,
      );
    if (Error.captureStackTrace) {
      Error.captureStackTrace(errorGen(), assertions);
    }

    expect.setState({
      expectedAssertionsNumber: expected,
      expectedAssertionsNumberErrorGen: errorGen,
    });
  }

  function hasAssertions() {
    const error = new Error('expected any number of assertion, but got none');
    if (Error.captureStackTrace) {
      Error.captureStackTrace(error, hasAssertions);
    }

    expect.setState({
      isExpectingAssertions: true,
      isExpectingAssertionsError: error,
    });
  }

  util.addMethod(expect, 'assertions', assertions);
  util.addMethod(expect, 'hasAssertions', hasAssertions);

  expect.extend(customMatchers);

  return expect;
}

let fileExpect: RstestExpect | undefined;

const getContextWorkerState = (): WorkerState => fileContext().workerState;

/**
 * The file-level `expect` is a build-once singleton with a STABLE identity
 * across files (the live-binding contract, see `../api`): it resolves the
 * running file's worker state and current test through `fileContext()` at call
 * time, so any value-copied reference (`expect.poll`, `.soft`, `{ ...api }`)
 * captured in a module shared under `isolate: false` stays live — no
 * delegation needed, there is only one instance. Per-file state is RESET, not
 * rebuilt. The per-test local expect (`context.expect`, created by the runner)
 * stays pinned to its test so concurrent tests and callbacks that outlive a
 * timeout cannot write into another test's matcher state.
 */
export const createFileExpect = (snapshotPlugin: ChaiPlugin): RstestExpect => {
  if (!fileExpect) {
    fileExpect = createExpect({
      getWorkerState: getContextWorkerState,
      getCurrentTest: () => fileContext().testRunner.getCurrentTest(),
      getElementTest: () => {
        const { testRunner } = fileContext();
        const activeTimeoutContext = testRunner.getCurrentTimeoutContext();
        const currentTest = testRunner.getCurrentTest();
        const timeoutContext = activeTimeoutContext ?? currentTest;
        // The file-level expect is shared, so the runner's current-test pointer
        // and browser task context are not reliable while concurrent flows are
        // interleaved. Tests use context.expect when they need their deadline;
        // concurrent suite hooks fall back to the configured poll timeout.
        return timeoutContext?.concurrent || timeoutContext?.inConcurrentScope
          ? undefined
          : timeoutContext;
      },
      snapshotPlugin,
    });
    // The slot the runner and `@vitest/expect` internals read; assigned once —
    // the singleton never changes identity.
    Object.defineProperty(globalThis, GLOBAL_EXPECT, {
      value: fileExpect,
      writable: true,
      configurable: true,
    });
    return fileExpect;
  }
  // Later files reuse the singleton on a clean slate, mirroring the previous
  // per-file rebuild (which also carried non-bookkeeping state forward).
  resetExpectState(fileExpect, fileExpectState(getContextWorkerState));
  return fileExpect;
};
