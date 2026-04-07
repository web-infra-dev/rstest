import { relative } from 'pathe';
import { parse as stackTraceParse } from 'stacktrace-parser';
import type {
  DefaultReporterOptions,
  Duration,
  GetSourcemap,
  NormalizedConfig,
  NormalizedProjectConfig,
  Reporter,
  RstestTestState,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { color, logger } from '../utils';
import { printSummaryErrorLogs, printSummaryLog } from './summary';

const DOT_BY_STATUS = {
  fail: 'F',
  pass: '.',
  skip: 'S',
  todo: 'T',
} as const;

const COLOR_BY_STATUS: Record<
  keyof typeof DOT_BY_STATUS,
  (message: string) => string
> = {
  fail: color.red,
  pass: color.green,
  skip: color.yellow,
  todo: color.gray,
};

export class DotReporter implements Reporter {
  private readonly rootPath: string;
  private readonly options: Pick<DefaultReporterOptions, 'logger' | 'summary'>;
  private readonly outputStream: NonNullable<
    DefaultReporterOptions['logger']
  >['outputStream'];
  private readonly getColumns: NonNullable<
    DefaultReporterOptions['logger']
  >['getColumns'];
  private currentColumn = 0;

  constructor({
    rootPath,
    options = {},
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options: Pick<DefaultReporterOptions, 'logger' | 'summary'>;
    testState: RstestTestState;
    projectConfigs?: Map<string, NormalizedProjectConfig>;
  }) {
    this.rootPath = rootPath;
    this.options = options;
    this.outputStream = options.logger?.outputStream ?? process.stdout;
    this.getColumns =
      options.logger?.getColumns ??
      (() => ('columns' in process.stdout ? process.stdout.columns || 80 : 80));
  }

  onTestCaseResult(result: TestResult): void {
    const marker = COLOR_BY_STATUS[result.status](DOT_BY_STATUS[result.status]);
    this.outputStream.write(marker);
    this.currentColumn += 1;

    if (this.currentColumn >= this.getColumnWidth()) {
      this.outputStream.write('\n');
      this.currentColumn = 0;
    }
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.flushLine();

    const titles = [];

    const testPath = relative(this.rootPath, log.testPath);

    if (log.trace) {
      const [frame] = stackTraceParse(log.trace);
      const filePath = relative(this.rootPath, frame!.file || '');

      if (filePath !== testPath) {
        titles.push(testPath);
      }
      titles.push(`${filePath}:${frame!.lineNumber}:${frame!.column}`);
    } else {
      titles.push(testPath);
    }
    const logOutput = log.type === 'stdout' ? logger.log : logger.stderr;

    logOutput('');
    logOutput(
      `${log.name}${color.gray(color.dim(` | ${titles.join(color.gray(color.dim(' | ')))}`))}`,
    );
    logOutput(log.content);
    logOutput('');
  }

  onExit(): void {
    this.flushLine();
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    getSourcemap,
    snapshotSummary,
    filterRerunTestPaths,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    getSourcemap: GetSourcemap;
    unhandledErrors?: Error[];
    filterRerunTestPaths?: string[];
  }): Promise<void> {
    this.flushLine();

    if (this.options.summary === false) {
      return;
    }

    await printSummaryErrorLogs({
      testResults,
      results,
      unhandledErrors,
      rootPath: this.rootPath,
      getSourcemap,
      filterRerunTestPaths,
    });

    printSummaryLog({
      results,
      testResults,
      duration,
      rootPath: this.rootPath,
      snapshotSummary,
    });
  }

  private flushLine(): void {
    if (this.currentColumn === 0) {
      return;
    }

    this.outputStream.write('\n');
    this.currentColumn = 0;
  }

  private getColumnWidth(): number {
    return Math.max(1, this.getColumns() || 80);
  }
}
