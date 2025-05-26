/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/integrations/chai/poll.ts
 */
import * as chai from 'chai';

import {
  ASYMMETRIC_MATCHERS_OBJECT,
  GLOBAL_EXPECT,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
  addCustomEqualityTesters,
  customMatchers,
  getState,
  setState,
} from '@vitest/expect';
import type {
  Assertion,
  MatcherState,
  RstestExpect,
  TestCase,
  WorkerState,
} from '../../types';
import { createExpectPoll } from './poll';
import { SnapshotPlugin } from './snapshot';

chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(SnapshotPlugin);
chai.use(JestAsymmetricMatchers);
export { GLOBAL_EXPECT };

export function createExpect({
  getCurrentTest,
  workerState,
}: {
  workerState: WorkerState;
  getCurrentTest: () => TestCase | undefined;
}): RstestExpect {
  const expect = ((value: any, message?: string): Assertion => {
    const { assertionCalls } = getState(expect);
    setState({ assertionCalls: assertionCalls + 1 }, expect);
    const assert = chai.expect(value, message) as unknown as Assertion;
    const _test = getCurrentTest();
    if (_test) {
      // @ts-expect-error internal
      return assert.withTest(_test) as Assertion;
    }
    return assert;
  }) as RstestExpect;
  Object.assign(expect, chai.expect);
  Object.assign(expect, (globalThis as any)[ASYMMETRIC_MATCHERS_OBJECT]);

  expect.getState = () => getState<MatcherState>(expect);
  expect.setState = (state) => setState(state as Partial<MatcherState>, expect);

  const globalState = getState((globalThis as any)[GLOBAL_EXPECT]) || {};

  setState<MatcherState>(
    {
      ...globalState,
      assertionCalls: 0,
      isExpectingAssertions: false,
      isExpectingAssertionsError: null,
      expectedAssertionsNumber: null,
      expectedAssertionsNumberErrorGen: null,
      get testPath() {
        return workerState.testPath;
      },
    },
    expect,
  );

  // @ts-expect-error untyped
  expect.extend = (matchers) => chai.expect.extend(expect, matchers);
  expect.addEqualityTesters = (customTesters) =>
    addCustomEqualityTesters(customTesters);

  expect.soft = (...args) => {
    // @ts-expect-error private soft access
    return expect(...args).withContext({ soft: true }) as Assertion;
  };

  expect.poll = createExpectPoll(expect);

  expect.unreachable = (message?: string) => {
    chai.assert.fail(
      `expected ${message ? `"${message}" ` : ''}not to be reached`,
    );
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

  chai.util.addMethod(expect, 'assertions', assertions);
  chai.util.addMethod(expect, 'hasAssertions', hasAssertions);

  expect.extend(customMatchers);

  return expect;
}
