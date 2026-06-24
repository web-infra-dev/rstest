import { relative } from 'pathe';
import stripAnsi from 'strip-ansi';
import type {
  Duration,
  FormattedError,
  GetSourcemap,
  Reporter,
  TestFileResult,
  TestResult,
} from '../types';
import { getTaskNameWithPrefix, logger } from '../utils';
import { formatStack, parseErrorStacktrace } from '../utils/error';

const SETUP_TEST_NAME = 'file setup';
const UNKNOWN_FAILURE_MESSAGE = 'Test failed without error details';

type ServiceMessageAttributes = Record<string, string | number | undefined>;

// https://www.jetbrains.com/help/teamcity/service-messages.html#Escaped+Values
function escapeValue(value: string | number | undefined): string {
  return stripAnsi(String(value ?? ''))
    .replace(/\|/g, '||')
    .replace(/\n/g, '|n')
    .replace(/\r/g, '|r')
    .replace(/\[/g, '|[')
    .replace(/\]/g, '|]')
    .replace(/\u0085/g, '|x')
    .replace(/\u2028/g, '|l')
    .replace(/\u2029/g, '|p')
    .replace(/'/g, "|'");
}

function formatServiceMessage(
  type: string,
  attributes: ServiceMessageAttributes,
): string {
  const formatted = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}='${escapeValue(value)}'`)
    .join(' ');

  return `##teamcity[${type} ${formatted}]`;
}

/**
 * Reports test results as TeamCity service messages on stdout, which TeamCity
 * (and compatible CIs) parse from the build log to populate the Tests tab.
 *
 * Like the `junit` and `github-actions` reporters, all messages are emitted in
 * a single `onTestRunEnd` pass over the result tree, so started/finished
 * messages are always balanced without tracking state.
 */
export class TeamcityReporter implements Reporter {
  private readonly rootPath: string;

  constructor({
    rootPath,
  }: {
    rootPath: string;
    options?: Record<string, unknown>;
  }) {
    this.rootPath = rootPath;
  }

  async onTestRunEnd({
    results,
    getSourcemap,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
  }): Promise<void> {
    for (const file of results) {
      await this.reportFile(file, getSourcemap);
    }
  }

  private emit(type: string, attributes: ServiceMessageAttributes): void {
    logger.log(formatServiceMessage(type, attributes));
  }

  private async errorDetails(
    error: FormattedError,
    getSourcemap: GetSourcemap,
  ): Promise<string | undefined> {
    const parts: string[] = [];

    if (error.diff) {
      parts.push(error.diff);
    }

    if (error.stack) {
      const stackFrames = await parseErrorStacktrace({
        stack: error.stack,
        fullStack: error.fullStack,
        getSourcemap,
      });
      const formattedStack = stackFrames
        .map((frame) => formatStack(frame, this.rootPath))
        .join('\n');

      if (formattedStack) {
        parts.push(formattedStack);
      }
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  // TeamCity keeps only one testFailed per test, so aggregate all errors
  // (e.g. expect.soft) into a single message. A comparison diff can only carry
  // one expected/actual pair, so it is reported only for a lone comparison error.
  private async reportFailure(
    test: TestResult,
    flowId: string,
    name: string,
    getSourcemap: GetSourcemap,
  ): Promise<void> {
    const errors = test.errors ?? [];

    if (errors.length === 0) {
      this.emit('testFailed', {
        flowId,
        message: UNKNOWN_FAILURE_MESSAGE,
        name,
      });
      return;
    }

    const [firstError] = errors;
    const comparison =
      errors.length === 1 &&
      firstError &&
      (firstError.expected !== undefined || firstError.actual !== undefined)
        ? firstError
        : undefined;
    const details =
      (
        await Promise.all(
          errors.map((error) => this.errorDetails(error, getSourcemap)),
        )
      )
        .filter(Boolean)
        .join('\n\n') || undefined;

    this.emit('testFailed', {
      actual: comparison?.actual,
      details,
      expected: comparison?.expected,
      flowId,
      message: errors.map((error) => error.message).join('\n'),
      name,
      type: comparison ? 'comparisonFailure' : undefined,
    });
  }

  private async reportCase(
    test: TestResult,
    flowId: string,
    getSourcemap: GetSourcemap,
  ): Promise<void> {
    const name = getTaskNameWithPrefix(test);

    this.emit('testStarted', { flowId, name });

    if (test.status === 'skip' || test.status === 'todo') {
      this.emit('testIgnored', { flowId, name });
    } else if (test.status === 'fail') {
      await this.reportFailure(test, flowId, name, getSourcemap);
    }

    this.emit('testFinished', {
      duration:
        typeof test.duration === 'number'
          ? Math.round(test.duration)
          : undefined,
      flowId,
      name,
    });
  }

  private async reportFile(
    file: TestFileResult,
    getSourcemap: GetSourcemap,
  ): Promise<void> {
    const name = relative(this.rootPath, file.testPath);

    this.emit('testSuiteStarted', { flowId: name, name });

    if (file.results.length > 0) {
      for (const test of file.results) {
        await this.reportCase(test, name, getSourcemap);
      }
    } else if (file.status === 'fail' && file.errors?.length) {
      await this.reportCase(
        { ...file, name: SETUP_TEST_NAME, parentNames: [] },
        name,
        getSourcemap,
      );
    }

    this.emit('testSuiteFinished', { flowId: name, name });
  }
}
