import { relative } from 'pathe';
import type { RstestTestState, TestCaseInfo, TestResult } from '../types';
import {
  bgColor,
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
import {
  WindowRenderer,
  type Options as WindowRendererOptions,
} from './windowedRenderer';

export class StatusRenderer {
  private readonly rootPath: string;
  private readonly renderer: WindowRenderer;
  private startTime: number | undefined = undefined;
  private readonly testState: RstestTestState;

  constructor(
    rootPath: string,
    state: RstestTestState,
    logger?: WindowRendererOptions['logger'],
  ) {
    this.rootPath = rootPath;
    this.renderer = new WindowRenderer({
      getWindow: () => this.getContent(),
      logger: logger ?? {
        outputStream: process.stdout,
        errorStream: process.stderr,
        getColumns: () => {
          return 'columns' in process.stdout ? process.stdout.columns : 80;
        },
      },
    });
    this.testState = state;
  }

  getContent(): string[] {
    this.startTime ??= Date.now();
    const now = Date.now();
    const summary = [];
    const runningModules = this.testState.getRunningModules();
    const testModules = this.testState.getTestModules();

    // only display running tests if they have been running for more than 2 seconds
    const shouldDisplayRunningTests = (runningTests: TestCaseInfo[]) => {
      return (
        runningTests[0]?.startTime && now - runningTests[0].startTime > 2000
      );
    };

    for (const [module, { runningTests }] of runningModules.entries()) {
      const relativePath = relative(this.rootPath, module);
      summary.push(
        `${bgColor('bgYellow', ' RUNS ')} ${prettyTestPath(relativePath)}`,
      );
      if (runningTests.length && shouldDisplayRunningTests(runningTests)) {
        let caseLog = ` ${color.gray(POINTER)} ${getTaskNameWithPrefix(runningTests[0]!)} ${color.magenta(prettyTime(now - runningTests[0]!.startTime!))}`;

        if (runningTests.length > 1) {
          caseLog += color.gray(` and ${runningTests.length - 1} more cases`);
        }

        summary.push(caseLog);
      }
    }

    summary.push('');

    if (testModules.length === 0) {
      summary.push(`${TestFileSummaryLabel} ${runningModules.size} total`);
    } else {
      summary.push(
        `${TestFileSummaryLabel} ${getSummaryStatusString(testModules, '', false)} ${color.dim('|')} ${runningModules.size + testModules.length} total`,
      );
    }

    const testResults: TestResult[] = Array.from(runningModules.values())
      .flatMap(({ results }) => results)
      .concat(testModules.flatMap((mod) => mod.results));

    if (testResults.length) {
      summary.push(
        `${TestSummaryLabel} ${getSummaryStatusString(testResults, '', false)}`,
      );
    }

    summary.push(`${DurationLabel} ${prettyTime(Date.now() - this.startTime)}`);

    summary.push('');

    return summary;
  }

  onTestFileStart(): void {
    this.renderer?.schedule();
  }

  onTestCaseResult(): void {
    this.renderer?.schedule();
  }

  onTestFileResult(): void {
    this.renderer?.schedule();
  }

  clear(): void {
    this.startTime = undefined;
    this.renderer?.finish();
  }
}
