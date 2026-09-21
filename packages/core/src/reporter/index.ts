import type {
  DefaultReporterOptions,
  InternalContext,
  NormalizedConfig,
  NormalizedProjectConfig,
  Reporter,
  RstestTestState,
  TestFileResult,
  TestResult,
  TestRunEndPayload,
  UserConsoleLog,
} from '../types';
import { runLifecycleStep } from '../core/finalizeRun';
import { color, flushOutputStreams, isTTY, logger } from '../utils';
import { NonTTYProgressNotifier } from './nonTtyProgressNotifier';
import { StatusRenderer } from './statusRenderer';
import { printSummaryErrorLogs, printSummaryLog } from './summary';
import { logCase, logFileTitle, logUserConsoleLog } from './utils';

export class DefaultReporter implements Reporter {
  readonly flushOutputStreams: boolean;

  protected rootPath: string;
  protected config: NormalizedConfig;
  protected projectConfigs: Map<string, NormalizedProjectConfig>;
  private readonly options: DefaultReporterOptions = {};
  protected statusRenderer: StatusRenderer | undefined;
  protected nonTTYProgressNotifier: NonTTYProgressNotifier | undefined;
  private readonly testState: RstestTestState;

  constructor({
    rootPath,
    options,
    config,
    testState,
    projectConfigs,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: DefaultReporterOptions;
    testState: RstestTestState;
    projectConfigs?: Map<string, NormalizedProjectConfig>;
  }) {
    this.rootPath = rootPath;
    this.config = config;
    this.projectConfigs = projectConfigs ?? new Map();
    this.options = options;
    this.testState = testState;
    this.flushOutputStreams = !options.logger;
    if (isTTY() || options.logger) {
      this.statusRenderer = new StatusRenderer(testState, options.logger);
    } else {
      this.nonTTYProgressNotifier = new NonTTYProgressNotifier(testState);
    }
  }

  onTestFileStart(): void {
    this.statusRenderer?.onTestFileStart();
    this.nonTTYProgressNotifier?.start();
  }

  protected withSuspendedStatusRenderer(fn: () => void): void {
    if (!this.statusRenderer) {
      fn();
      return;
    }

    this.statusRenderer.suspendWindowOutput();
    try {
      fn();
    } finally {
      this.statusRenderer.resumeWindowOutput();
    }
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.nonTTYProgressNotifier?.notifyOutput();
    this.withSuspendedStatusRenderer(() => {
      logUserConsoleLog(this.rootPath, log);
    });
  }

  onTestCaseResult(_result: TestResult): void {
    this.statusRenderer?.onTestCaseResult();
  }

  protected resolveFileOptions(project: string): {
    hideSkippedTestFiles: boolean;
    hideSkippedTests: boolean;
    slowTestThreshold: number;
  } {
    const projectConfig = this.projectConfigs.get(project);
    return {
      hideSkippedTestFiles:
        projectConfig?.hideSkippedTestFiles ??
        this.config.hideSkippedTestFiles ??
        false,
      hideSkippedTests:
        projectConfig?.hideSkippedTests ?? this.config.hideSkippedTests,
      slowTestThreshold:
        projectConfig?.slowTestThreshold ?? this.config.slowTestThreshold,
    };
  }

  onTestFileResult(test: TestFileResult): void {
    this.statusRenderer?.onTestFileResult();
    this.nonTTYProgressNotifier?.notifyOutput();

    const { hideSkippedTestFiles, hideSkippedTests, slowTestThreshold } =
      this.resolveFileOptions(test.project);

    if (hideSkippedTestFiles && test.status === 'skipped') {
      return;
    }

    const logResults = () => {
      logFileTitle(
        test,
        test.relativeTestPath,
        false,
        this.options.showProjectName,
      );
      const showAllCases = this.testState.getTestFiles()?.length === 1;

      for (const result of test.results) {
        const isDisplayed =
          showAllCases ||
          result.status === 'failed' ||
          (result.duration ?? 0) > slowTestThreshold ||
          (result.retryCount ?? 0) > 0;
        if (isDisplayed) {
          logCase(result, {
            slowTestThreshold,
            hideSkippedTests,
          });
        }
      }
    };

    this.withSuspendedStatusRenderer(logResults);
  }

  onExit(): void {
    this.statusRenderer?.clear();
    this.statusRenderer?.stop();
    this.nonTTYProgressNotifier?.stop();
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    summary,
    getSourcemap,
    snapshotSummary,
    rerunTestPaths,
    unhandledErrors,
  }: TestRunEndPayload): Promise<void> {
    this.statusRenderer?.clear();
    this.nonTTYProgressNotifier?.stop();

    if (this.options.summary === false) {
      return;
    }

    const hasErrorLogs = await printSummaryErrorLogs({
      testResults,
      results,
      unhandledErrors,
      rootPath: this.rootPath,
      getSourcemap,
      rerunTestPaths,
    });

    if (hasErrorLogs && this.flushOutputStreams) {
      await flushOutputStreams();
    }

    printSummaryLog({
      results,
      duration,
      summary,
      rootPath: this.rootPath,
      snapshotSummary,
    });
  }
}

export function exitReporters(
  context: Pick<InternalContext, 'reporters'>,
): Promise<void> {
  const exits: Promise<void>[] = [];
  for (const reporter of context.reporters.splice(0)) {
    const { onExit } = reporter;
    if (!onExit) {
      continue;
    }
    exits.push(
      runLifecycleStep('reporter onExit', async () => {
        await onExit.call(reporter);
      }).catch((error) => {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }),
    );
  }
  return Promise.all(exits).then(() => {});
}
