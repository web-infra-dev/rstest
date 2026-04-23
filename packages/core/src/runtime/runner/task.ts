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

type TestModeContext = {
  shouldSkipByName?: (test: TestCase) => boolean;
  suiteHasOnlyDescendants: WeakMap<TestSuite, boolean>;
};

const collectOnlyTests = (
  tests: Test[],
  suiteHasOnlyDescendants: WeakMap<TestSuite, boolean>,
): boolean => {
  let hasOnly = false;

  for (const test of tests) {
    const childrenHaveOnly =
      test.type === 'suite'
        ? collectOnlyTests(test.tests, suiteHasOnlyDescendants)
        : false;

    if (test.type === 'suite') {
      suiteHasOnlyDescendants.set(test, childrenHaveOnly);
    }

    if (test.runMode === 'only' || childrenHaveOnly) {
      hasOnly = true;
    }
  }

  return hasOnly;
};

const createShouldSkipByName = (
  testNamePattern?: RegExp | string,
): ((test: TestCase) => boolean) | undefined => {
  if (!testNamePattern) {
    return undefined;
  }

  const regex =
    typeof testNamePattern === 'string'
      ? new RegExp(testNamePattern)
      : testNamePattern;
  const delimiter = regex.toString().includes(TEST_DELIMITER)
    ? TEST_DELIMITER
    : '';

  return (test: TestCase) => {
    if (regex.global || regex.sticky) {
      regex.lastIndex = 0;
    }

    return !regex.test(getTaskNameWithPrefix(test, delimiter));
  };
};

const shouldTestSkip = (
  test: TestCase,
  runOnly: boolean,
  shouldSkipByName?: (test: TestCase) => boolean,
) => {
  if (runOnly && test.runMode !== 'only') {
    return true;
  }

  if (shouldSkipByName?.(test)) {
    return true;
  }

  return false;
};

const traverseUpdateTestRunModeWithContext = (
  testSuite: TestSuite,
  parentRunMode: TestRunMode,
  runOnly: boolean,
  context: TestModeContext,
): void => {
  if (testSuite.tests.length === 0) {
    return;
  }

  const childrenHaveOnly =
    context.suiteHasOnlyDescendants.get(testSuite) ?? false;

  if (runOnly && testSuite.runMode !== 'only' && !childrenHaveOnly) {
    testSuite.runMode = 'skip';
  } else if (['skip', 'todo'].includes(parentRunMode)) {
    testSuite.runMode = parentRunMode;
  }

  const runSubOnly =
    runOnly && testSuite.runMode !== 'only' ? runOnly : childrenHaveOnly;
  let hasRunTest = false;
  let allTodoTest = true;

  for (const test of testSuite.tests) {
    if (test.type === 'case') {
      if (['skip', 'todo'].includes(testSuite.runMode)) {
        test.runMode = testSuite.runMode;
      }
      if (shouldTestSkip(test, runSubOnly, context.shouldSkipByName)) {
        test.runMode = 'skip';
      }
    } else {
      traverseUpdateTestRunModeWithContext(
        test,
        testSuite.runMode,
        runSubOnly,
        context,
      );
    }

    if (test.runMode === 'run' || test.runMode === 'only') {
      hasRunTest = true;
    }

    if (test.runMode !== 'todo') {
      allTodoTest = false;
    }
  }

  if (testSuite.runMode !== 'run') {
    return;
  }

  if (hasRunTest) {
    testSuite.runMode = 'run';
    return;
  }

  testSuite.runMode = allTodoTest ? 'todo' : 'skip';
};

export const traverseUpdateTestRunMode = (
  testSuite: TestSuite,
  parentRunMode: TestRunMode,
  runOnly: boolean,
  testNamePattern?: RegExp | string,
): void => {
  const suiteHasOnlyDescendants = new WeakMap<TestSuite, boolean>();
  collectOnlyTests([testSuite], suiteHasOnlyDescendants);

  traverseUpdateTestRunModeWithContext(testSuite, parentRunMode, runOnly, {
    shouldSkipByName: createShouldSkipByName(testNamePattern),
    suiteHasOnlyDescendants,
  });
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
  const suiteHasOnlyDescendants = new WeakMap<TestSuite, boolean>();
  const hasOnly = collectOnlyTests(tests, suiteHasOnlyDescendants);
  const shouldSkipByName = createShouldSkipByName(testNamePattern);

  for (const test of tests) {
    if (test.type === 'suite') {
      traverseUpdateTestRunModeWithContext(test, 'run', hasOnly, {
        shouldSkipByName,
        suiteHasOnlyDescendants,
      });
    } else if (shouldTestSkip(test, hasOnly, shouldSkipByName)) {
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

function makeError(message: string, stackTraceError?: Error): Error {
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
