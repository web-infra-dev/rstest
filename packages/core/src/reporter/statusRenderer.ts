import { relative } from 'pathe';
import type { TestCaseInfo, TestFileResult, TestResult } from '../types';
import {
  color,
  getTaskNameWithPrefix,
  POINTER,
  prettyTestPath,
  prettyTime,
} from '../utils';
import {
  DurationLabel,
  getSummaryStatusString,
  TestFileSummaryLabel,
  TestSummaryLabel,
} from './summary';
import { WindowRenderer } from './windowedRenderer';

export class StatusRenderer {
  private rootPath: string;
  private renderer: WindowRenderer;
  private runningModules = new Map<
    string,
    { runningTests: TestCaseInfo[]; results: TestResult[] }
  >();
  private testModules: TestFileResult[] = [];
  private startTime: number | undefined = undefined;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.renderer = new WindowRenderer({
      getWindow: () => this.getContent(),
      logger: {
        outputStream: process.stdout,
        errorStream: process.stderr,
        getColumns: () => {
          return 'columns' in process.stdout ? process.stdout.columns : 80;
        },
      },
    });
  }

  getContent(): string[] {
    this.startTime ??= Date.now();
    const now = Date.now();
    const summary = [];

    // only display running tests if they have been running for more than 2 seconds
    const shouldDisplayRunningTests = (runningTests: TestCaseInfo[]) => {
      return (
        runningTests[0]?.startTime && now - runningTests[0].startTime > 2000
      );
    };

    for (const [module, { runningTests }] of this.runningModules.entries()) {
      const relativePath = relative(this.rootPath, module);
      summary.push(
        `${color.bgYellow(color.bold(' RUNS '))} ${prettyTestPath(relativePath)}`,
      );
      if (runningTests.length && shouldDisplayRunningTests(runningTests)) {
        let caseLog = ` ${color.gray(POINTER)}  ${getTaskNameWithPrefix(runningTests[0]!)} ${color.magenta(prettyTime(now - runningTests[0]!.startTime!))}`;

        if (runningTests.length > 1) {
          caseLog += color.gray(` and ${runningTests.length - 1} more cases`);
        }

        summary.push(caseLog);
      }
    }

    summary.push('');

    if (this.testModules.length === 0) {
      summary.push(`${TestFileSummaryLabel} ${this.runningModules.size} total`);
    } else {
      summary.push(
        `${TestFileSummaryLabel} ${getSummaryStatusString(this.testModules, '', false)} ${color.dim('|')} ${this.runningModules.size + this.testModules.length} total`,
      );
    }

    const testResults: TestResult[] = Array.from(this.runningModules.values())
      .flatMap(({ results }) => results)
      .concat(this.testModules.flatMap((mod) => mod.results));

    if (testResults.length) {
      summary.push(
        `${TestSummaryLabel} ${getSummaryStatusString(testResults, '', false)}`,
      );
    }

    summary.push(`${DurationLabel} ${prettyTime(Date.now() - this.startTime)}`);

    summary.push('');

    return summary;
  }

  onTestFileStart(testPath: string): void {
    this.runningModules.set(testPath, { runningTests: [], results: [] });
    this.renderer?.schedule();
  }

  onTestCaseResult(result: TestResult): void {
    const currentModule = this.runningModules.get(result.testPath);
    if (!currentModule) {
      this.runningModules.set(result.testPath, {
        runningTests: [],
        results: [result],
      });
    } else {
      // Find and remove the test from runningTests by matching testId
      const filteredRunningTests = currentModule.runningTests.filter(
        (t) => t.testId !== result.testId,
      );
      this.runningModules.set(result.testPath, {
        runningTests: filteredRunningTests,
        results: [...currentModule.results, result],
      });
    }

    this.renderer?.schedule();
  }

  onTestCaseStart(test: TestCaseInfo): void {
    const currentModule = this.runningModules.get(test.testPath);
    if (!currentModule) {
      this.runningModules.set(test.testPath, {
        runningTests: [test],
        results: [],
      });
    } else {
      // Remove from runningTests if it exists (for restart scenarios)
      const filteredRunningTests = currentModule.runningTests.filter(
        (t) => t.testId !== test.testId,
      );
      this.runningModules.set(test.testPath, {
        runningTests: [...filteredRunningTests, test],
        results: currentModule.results,
      });
    }
  }

  onTestFileResult(test: TestFileResult): void {
    this.runningModules.delete(test.testPath);
    this.testModules.push(test);
    this.renderer?.schedule();
  }

  clear(): void {
    this.testModules.length = 0;
    this.runningModules.clear();
    this.startTime = undefined;
    this.renderer?.finish();
  }
}
