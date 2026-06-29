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
  type ChaiPlugin,
  customMatchers,
  GLOBAL_EXPECT,
  getState,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
  setState,
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
  RstestExpect,
  TestCase,
  WorkerState,
} from '../../types';
import { toNativePath } from '../../utils/helper';
import { fileContext } from '../fileContext';
import { createExpectPoll } from './poll';

export { assert } from 'chai';

export function setupChaiConfig(config: ChaiConfig): void {
  Object.assign(chaiConfig, config);
}

/**
 * The per-file slate of `expect` state: assertion bookkeeping cleared and
 * `testPath` (re-)established as a live getter — the runner pins `testPath` to
 * a plain value per test, so each file must restore the getter.
 */
const freshExpectState = (
  getWorkerState: () => WorkerState,
): Partial<MatcherState> => ({
  assertionCalls: 0,
  isExpectingAssertions: false,
  isExpectingAssertionsError: null,
  expectedAssertionsNumber: null,
  expectedAssertionsNumberErrorGen: null,
  // `testPath` is user-facing; expose the OS-native path (equal to
  // `import.meta.filename`) for every expect instance — global and the
  // public per-test `context.expect` alike. Internally it stays POSIX (#1465).
  get testPath() {
    return toNativePath(getWorkerState().testPath);
  },
});

export function createExpect({
  getCurrentTest,
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
  snapshotPlugin?: ChaiPlugin;
}): RstestExpect {
  use(JestExtend);
  use(JestChaiExpect);
  if (snapshotPlugin) {
    use(snapshotPlugin);
  }
  use(JestAsymmetricMatchers);

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

  expect.getState = () => getState<MatcherState>(expect);
  expect.setState = (state) => setState(state, expect);

  const globalState = getState((globalThis as any)[GLOBAL_EXPECT]) || {};

  setState<MatcherState>({ ...globalState }, expect);
  // Separate call: `setState` merges property DESCRIPTORS, which keeps the
  // `testPath` getter that a spread literal would have eagerly evaluated.
  setState<MatcherState>(freshExpectState(getWorkerState), expect);

  // @ts-expect-error chai.expect.extend untyped
  expect.extend = (matchers) => chaiExpect.extend(expect, matchers);
  expect.addEqualityTesters = (customTesters) =>
    addCustomEqualityTesters(customTesters);

  expect.soft = (...args) => {
    // @ts-expect-error private soft access
    return expect(...args).withContext({ soft: true }) as Assertion;
  };

  expect.poll = createExpectPoll(expect);

  (expect as any).element = () => {
    throw new Error(
      'expect.element() is only available in browser mode. ' +
        'Enable browser mode in config and import @rstest/browser to install the browser expect adapter.',
    );
  };

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
 * rebuilt. The per-test local expect (`context.expect`, created via
 * `createExpect` in the runner) intentionally stays a pinned per-test instance
 * to keep `test.concurrent` isolation.
 */
export const createFileExpect = (snapshotPlugin: ChaiPlugin): RstestExpect => {
  if (!fileExpect) {
    fileExpect = createExpect({
      getWorkerState: getContextWorkerState,
      getCurrentTest: () => fileContext().testRunner.getCurrentTest(),
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
  setState<MatcherState>(freshExpectState(getContextWorkerState), fileExpect);
  return fileExpect;
};
