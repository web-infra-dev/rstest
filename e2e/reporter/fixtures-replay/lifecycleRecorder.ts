import type {
  Reporter,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
} from '@rstest/core';

// `UserConsoleLog` is not part of the public `@rstest/core` type exports.
type UserConsoleLog = Parameters<NonNullable<Reporter['onUserConsoleLog']>>[0];

/**
 * Records every reporter hook it receives so a live run and a
 * `--merge-reports` replay of the same run can be compared event for event.
 * Identifiers rather than payloads: timings and stacks legitimately differ.
 */
export class LifecycleRecorder implements Reporter {
  private readonly events: string[] = [];

  private record(hook: string, ...detail: (string | undefined)[]): void {
    this.events.push([hook, ...detail].join(' | '));
  }

  onTestRunStart(): void {
    this.record('onTestRunStart');
  }

  onTestFileStart(file: TestFileInfo): void {
    this.record('onTestFileStart', file.testId);
  }

  onTestFileReady(file: TestFileInfo): void {
    this.record('onTestFileReady', file.testId, `${file.tests.length} roots`);
  }

  onTestSuiteStart(suite: TestSuiteInfo): void {
    this.record('onTestSuiteStart', suite.testId, suite.name);
  }

  onTestSuiteResult(result: TestResult): void {
    this.record('onTestSuiteResult', result.testId, result.name, result.status);
  }

  onTestCaseStart(test: TestCaseInfo): void {
    // `startTime`/`timeout` exist only on the live payload, not in the
    // collected tree — record them so a replay that rebuilds the payload from
    // the tree cannot pass. Same run on both sides, so the values are stable.
    this.record(
      'onTestCaseStart',
      test.testId,
      test.name,
      `startTime=${test.startTime === undefined ? 'unset' : 'set'}`,
      `timeout=${test.timeout}`,
    );
  }

  onTestCaseResult(result: TestResult): void {
    this.record('onTestCaseResult', result.testId, result.name, result.status);
  }

  onTestFileResult(result: TestFileResult): void {
    this.record('onTestFileResult', result.testId, result.status);
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.record('onUserConsoleLog', log.taskId, log.content.trim());
  }

  onTestRunEnd(): void {
    this.record('onTestRunEnd');
    console.log(`__RSTEST_LIFECYCLE__${JSON.stringify(this.events)}__END__`);
  }
}
