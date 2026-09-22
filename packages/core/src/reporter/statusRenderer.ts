import type { RstestTestState, TestCaseInfo, TestResult } from '../types';
import { bgColor, color, POINTER, prettyTestPath, prettyTime } from '../utils';
import {
  DurationLabel,
  formatStatusCounts,
  TestFileSummaryLabel,
  TestSummaryLabel,
} from './summary';
import { getFileSummary } from './utils';
import {
  WindowRenderer,
  type Options as WindowRendererOptions,
} from './windowedRenderer';

export class StatusRenderer {
  private readonly renderer: WindowRenderer;
  private startTime: number | undefined = undefined;
  private readonly testState: RstestTestState;

  constructor(
    state: RstestTestState,
    logger?: WindowRendererOptions['logger'],
  ) {
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

    if (runningModules.size === 0) {
      return [];
    }

    // only display running tests if they have been running for more than 2 seconds
    const shouldDisplayRunningTests = (runningTests: TestCaseInfo[]) => {
      return (
        runningTests[0]?.startTime && now - runningTests[0].startTime > 2000
      );
    };

    for (const { runningTests, relativeTestPath } of runningModules.values()) {
      summary.push(
        `${bgColor('bgYellow', ' RUNS ')} ${prettyTestPath(relativeTestPath)}`,
      );
      if (runningTests.length && shouldDisplayRunningTests(runningTests)) {
        let caseLog = ` ${color.gray(POINTER)} ${runningTests[0]!.fullName} ${color.magenta(prettyTime(now - runningTests[0]!.startTime!))}`;

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
        `${TestFileSummaryLabel} ${formatStatusCounts(getFileSummary(testModules), 'ansi', '', false)} ${color.dim('|')} ${runningModules.size + testModules.length} total`,
      );
    }

    const testResults: TestResult[] = Array.from(runningModules.values())
      .flatMap(({ results }) => results)
      .concat(testModules.flatMap((mod) => mod.results));

    if (testResults.length) {
      summary.push(
        `${TestSummaryLabel} ${formatStatusCounts(getFileSummary(testResults), 'ansi', '', false)}`,
      );
    }

    summary.push(`${DurationLabel} ${prettyTime(Date.now() - this.startTime)}`);

    summary.push('');

    return summary;
  }

  onTestFileStart(): void {
    this.renderer.start();
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

  stop(): void {
    this.renderer.stop();
  }

  suspendWindowOutput(): void {
    this.renderer.suspendWindowOutput();
  }

  resumeWindowOutput(): void {
    this.renderer.resumeWindowOutput();
  }
}
