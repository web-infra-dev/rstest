import { relative } from 'pathe';
import type {
  Duration,
  GetSourcemap,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../types';
import {
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  TEST_DELIMITER,
} from '../utils';

export class GithubActionsReporter {
  private onWritePath: (path: string) => string;
  private rootPath: string;

  constructor({
    options,
    rootPath,
  }: {
    rootPath: string;
    options: { onWritePath: (path: string) => string };
  }) {
    this.onWritePath = options.onWritePath;
    this.rootPath = rootPath;
  }

  async onTestRunEnd({
    results,
    testResults,
    getSourcemap,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
  }): Promise<void> {
    const failedTests: TestResult[] = [
      ...results.filter((i) => i.status === 'fail' && i.errors?.length),
      ...testResults.filter((i) => i.status === 'fail'),
    ];

    if (failedTests.length === 0) {
      return;
    }

    const { parseErrorStacktrace } = await import('../utils/error');

    for (const test of failedTests) {
      const { testPath } = test;
      const nameStr = getTaskNameWithPrefix(test);
      const shortPath = relative(this.rootPath, testPath);
      const title = `${prettyTestPath(shortPath)} ${TEST_DELIMITER} ${nameStr}`;

      for (const error of test.errors || []) {
        let file = testPath;
        let line = 1;
        let column = 1;

        const message = `${error.message}${error.diff ? `\n${error.diff}` : ''}`;
        const type = 'error';

        if (error.stack) {
          const stackFrames = await parseErrorStacktrace({
            stack: error.stack,
            fullStack: error.fullStack,
            getSourcemap,
          });
          if (stackFrames[0]) {
            file = stackFrames[0].file || test.testPath;
            line = stackFrames[0].lineNumber || 1;
            column = stackFrames[0].column || 1;
          }
        }

        logger.log(
          `::${type} file=${this.onWritePath?.(file) || file},line=${line},col=${column},title=${escapeData(title)}::${escapeData(message)}`,
        );
      }
    }
  }
}

function escapeData(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}
