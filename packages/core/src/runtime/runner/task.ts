import type {
  Test,
  TestResult,
  TestResultStatus,
  TestRunMode,
  TestSuite,
} from '../../types';

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

export const traverseUpdateTestRunMode = (
  testSuite: TestSuite,
  parentRunMode: TestRunMode,
  runOnly: boolean,
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
      if (runSubOnly && test.runMode !== 'only') {
        test.runMode = 'skip';
      }
      return test;
    }
    traverseUpdateTestRunMode(test, testSuite.runMode, runSubOnly);
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
 */
export const updateTestModes = (tests: Test[]): void => {
  const hasOnly = hasOnlyTest(tests);

  for (const test of tests) {
    if (test.type === 'suite') {
      traverseUpdateTestRunMode(test, 'run', hasOnly);
    } else if (hasOnly && test.runMode !== 'only') {
      test.runMode = 'skip';
    }
  }
};

export const markAllTestAsSkipped = (test: Test[]): void => {
  for (const t of test) {
    t.runMode = 'skip';
    if (t.type === 'suite') {
      markAllTestAsSkipped(t.tests);
    }
  }
};
