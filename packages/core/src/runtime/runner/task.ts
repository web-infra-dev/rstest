import type {
  Test,
  TestCase,
  TestResult,
  TestResultStatus,
  TestRunMode,
  TestSuite,
  TestSuiteListeners,
} from '../../types';
import { ROOT_SUITE_NAME, TEST_DELIMITER } from '../../utils/constants';
import { getTaskNameWithPrefix } from '../../utils/helper';
import { getRealTimers } from '../util';

export const getTestStatus = (
  results: TestResult[],
  defaultStatus: TestResultStatus,
): TestResultStatus => {
  if (results.length === 0) {
    return defaultStatus;
  }
  return results.some((result) => result.status === 'fail')
    ? 'fail'
    : results.every((result) => result.status === 'todo')
      ? 'todo'
      : results.every((result) => result.status === 'skip')
        ? 'skip'
        : 'pass';
};

export function hasOnlyTest(test: Test[]): boolean {
  return test.some((t) => {
    return t.runMode === 'only' || (t.type === 'suite' && hasOnlyTest(t.tests));
  });
}

const shouldTestSkip = (
  test: TestCase,
  runOnly: boolean,
  testNamePattern?: RegExp | string,
) => {
  if (runOnly && test.runMode !== 'only') {
    return true;
  }

  const delimiter = testNamePattern?.toString().includes(TEST_DELIMITER)
    ? TEST_DELIMITER
    : '';

  if (
    testNamePattern &&
    !getTaskNameWithPrefix(test, delimiter).match(testNamePattern)
  ) {
    return true;
  }

  return false;
};

export const traverseUpdateTestRunMode = (
  testSuite: TestSuite,
  parentRunMode: TestRunMode,
  runOnly: boolean,
  testNamePattern?: RegExp | string,
): void => {
  if (testSuite.tests.length === 0) {
    return;
  }

  if (
    runOnly &&
    testSuite.runMode !== 'only' &&
    !hasOnlyTest(testSuite.tests)
  ) {
    testSuite.runMode = 'skip';
  } else if (['skip', 'todo'].includes(parentRunMode)) {
    testSuite.runMode = parentRunMode;
  }

  const tests = testSuite.tests.map((test) => {
    const runSubOnly =
      runOnly && testSuite.runMode !== 'only'
        ? runOnly
        : hasOnlyTest(testSuite.tests);

    if (test.type === 'case') {
      if (['skip', 'todo'].includes(testSuite.runMode)) {
        test.runMode = testSuite.runMode;
      }
      if (shouldTestSkip(test, runSubOnly, testNamePattern)) {
        test.runMode = 'skip';
      }
      return test;
    }
    traverseUpdateTestRunMode(
      test,
      testSuite.runMode,
      runSubOnly,
      testNamePattern,
    );
    return test;
  });

  if (testSuite.runMode !== 'run') {
    return;
  }

  const hasRunTest = tests.some(
    (test) => test.runMode === 'run' || test.runMode === 'only',
  );

  if (hasRunTest) {
    testSuite.runMode = 'run';
    return;
  }

  const allTodoTest = tests.every((test) => test.runMode === 'todo');

  testSuite.runMode = allTodoTest ? 'todo' : 'skip';
};

/**
 * sets the runMode of the test based on the runMode of its parent suite
 * - if the parent suite is 'todo', set the test to 'todo'
 * - if the parent suite is 'skip', set the test to 'skip'
 *
 * sets the runMode of the test suite based on the runMode of its tests
 * - if some tests are 'run', set the suite to 'run'
 * - if all tests are 'todo', set the suite to 'todo'
 * - if all tests are 'skip', set the suite to 'skip'
 *
 * If any tasks been marked as `only`, mark all other tasks as `skip`.
 *
 * If `testNamePattern` defined, run only tests with a name that matches the regex. (The above rules still take effect)
 */
export const updateTestModes = (
  tests: Test[],
  testNamePattern?: RegExp | string,
): void => {
  const hasOnly = hasOnlyTest(tests);

  for (const test of tests) {
    if (test.type === 'suite') {
      traverseUpdateTestRunMode(test, 'run', hasOnly, testNamePattern);
    } else if (shouldTestSkip(test, hasOnly, testNamePattern)) {
      test.runMode = 'skip';
    }
  }
};

const updateTestParents = (tests: Test[], parentNames: string[] = []): void => {
  for (const test of tests) {
    test.parentNames = parentNames;
    if (test.type === 'suite') {
      const names =
        test.name === ROOT_SUITE_NAME
          ? parentNames
          : parentNames.concat(test.name);
      updateTestParents(test.tests, names);
    }
  }
};

export const traverseUpdateTest = (
  tests: Test[],
  testNamePattern?: RegExp | string,
): void => {
  updateTestParents(tests);
  updateTestModes(tests, testNamePattern);
};

export const markAllTestAsSkipped = (test: Test[]): void => {
  for (const t of test) {
    t.runMode = 'skip';
    if (t.type === 'suite') {
      markAllTestAsSkipped(t.tests);
    }
  }
};

type ListenersKey<T extends TestSuiteListeners> =
  T extends `${infer U}Listeners` ? U : never;
export function registerTestSuiteListener(
  suite: TestSuite,
  key: ListenersKey<TestSuiteListeners>,
  fn: (...args: any[]) => any,
): void {
  const listenersKey: TestSuiteListeners = `${key}Listeners`;
  suite[listenersKey] ??= [];
  suite[listenersKey].push(fn);
}

export function makeError(message: string, stackTraceError?: Error): Error {
  const error = new Error(message);
  if (stackTraceError?.stack) {
    error.stack = stackTraceError.stack.replace(
      error.message,
      stackTraceError.message,
    );
  }
  return error;
}

export function wrapTimeout<T extends (...args: any[]) => any>({
  name,
  fn,
  timeout,
  getAssertionCalls,
  stackTraceError,
}: {
  name: string;
  fn: T;
  timeout?: number;
  getAssertionCalls?: () => number;
  stackTraceError: Error;
}): T {
  if (!timeout) {
    return fn;
  }

  return (async (...args: Parameters<T>) => {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = getRealTimers().setTimeout!(() => {
        const assertionCalls = getAssertionCalls?.() || 0;
        const assertionInfo =
          assertionCalls > 0
            ? ` (completed ${assertionCalls} expect assertion${assertionCalls === 1 ? '' : 's'})`
            : ' (no expect assertions completed)';
        const message = `${name} timed out in ${timeout}ms${getAssertionCalls ? assertionInfo : ''}`;

        // Create timeout error with the provided stack trace from test registration
        reject(makeError(message, stackTraceError));
      }, timeout);
    });

    try {
      const result = await Promise.race([fn(...args), timeoutPromise]);
      timeoutId && clearTimeout(timeoutId);
      return result;
    } catch (error) {
      timeoutId && clearTimeout(timeoutId);
      throw error;
    }
  }) as T;
}

export function limitConcurrency(
  concurrency: number = Number.POSITIVE_INFINITY,
): <Args extends unknown[], T>(
  func: (...args: Args) => PromiseLike<T> | T,
  ...args: Args
) => Promise<T> {
  let running = 0;
  const queue: (() => void)[] = [];

  const runNext = () => {
    if (queue.length > 0 && running < concurrency) {
      running++;
      const next = queue.shift()!;
      next();
    }
  };

  return (func, ...args) => {
    return new Promise((resolve, reject) => {
      const task = () => {
        Promise.resolve(func(...args))
          .then(resolve)
          .catch(reject)
          .finally(() => {
            running--;
            runNext();
          });
      };

      if (running < concurrency) {
        running++;
        task();
      } else {
        queue.push(task);
      }
    });
  };
}
