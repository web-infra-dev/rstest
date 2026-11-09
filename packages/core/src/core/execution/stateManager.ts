import type {
  RstestTestState,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from '../../types';

/**
 * One (project, browser, path) triple per module state: a test path alone is
 * ambiguous once another project (node pool) or another browser (browser
 * mode) runs the same file in the same cycle, and each run of the file keeps
 * its own running/case state here so reporters never collapse them. `browser`
 * is empty for the node pool.
 */
const fileStateKey = (file: {
  project: string;
  browserName?: string;
  testPath: string;
}): string =>
  `${file.project}\u0000${file.browserName ?? ''}\u0000${file.testPath}`;

export class TestStateManager {
  public runningModules: ReturnType<RstestTestState['getRunningModules']> =
    new Map();

  public testModules: TestFileResult[] = [];
  public testFiles: string[] | undefined = undefined;
  private failedTestCount = 0;

  /** The module state a (project, browser, path) run currently holds. */
  runningModuleFor(file: {
    project: string;
    browserName?: string;
    testPath: string;
  }):
    | {
        relativeTestPath: string;
        runningTests: TestCaseInfo[];
        results: TestResult[];
      }
    | undefined {
    return this.runningModules.get(fileStateKey(file));
  }

  onTestFileStart({
    project,
    browserName,
    testPath,
    relativeTestPath,
  }: Pick<
    TestFileInfo,
    'project' | 'browserName' | 'testPath' | 'relativeTestPath'
  >): void {
    const key = fileStateKey({ project, browserName, testPath });
    const currentModule = this.runningModules.get(key);
    if (currentModule) {
      this.failedTestCount -= currentModule.results.filter(
        (result) => result.status === 'failed',
      ).length;
    }
    this.runningModules.set(key, {
      relativeTestPath,
      runningTests: [],
      results: [],
    });
  }

  onTestCaseResult(result: TestResult): void {
    const key = fileStateKey(result);
    const currentModule = this.runningModules.get(key);
    if (!currentModule) {
      this.runningModules.set(key, {
        relativeTestPath: result.relativeTestPath,
        runningTests: [],
        results: [result],
      });
    } else {
      const runningTestIndex = currentModule.runningTests.findIndex(
        (test) => test.testId === result.testId,
      );
      if (runningTestIndex !== -1) {
        currentModule.runningTests.splice(runningTestIndex, 1);
      }
      currentModule.results.push(result);
    }
    if (result.status === 'failed') {
      this.failedTestCount++;
    }
  }

  onTestCaseStart(test: TestCaseInfo): void {
    const key = fileStateKey(test);
    const currentModule = this.runningModules.get(key);
    if (!currentModule) {
      this.runningModules.set(key, {
        relativeTestPath: test.relativeTestPath,
        runningTests: [test],
        results: [],
      });
    } else {
      const runningTestIndex = currentModule.runningTests.findIndex(
        (runningTest) => runningTest.testId === test.testId,
      );
      if (runningTestIndex !== -1) {
        currentModule.runningTests.splice(runningTestIndex, 1);
      }
      currentModule.runningTests.push(test);
    }
  }

  getCountOfFailedTests(): number {
    return this.failedTestCount;
  }

  onTestFileResult(test: TestFileResult): void {
    const key = fileStateKey(test);
    const currentModule = this.runningModules.get(key);
    if (currentModule) {
      this.failedTestCount -= currentModule.results.filter(
        (result) => result.status === 'failed',
      ).length;
    }
    this.runningModules.delete(key);
    this.failedTestCount +=
      test.results.length > 0
        ? test.results.filter((result) => result.status === 'failed').length
        : test.status === 'failed'
          ? 1
          : 0;
    this.testModules.push(test);
  }

  reset(): void {
    this.runningModules.clear();
    this.testModules = [];
    this.testFiles = undefined;
    this.failedTestCount = 0;
  }
}
