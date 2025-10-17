import { relative } from 'pathe';
import type { TestFileResult, TestResult } from '../types';
import { color, prettyTestPath, prettyTime } from '../utils';
import { getSummaryStatusString } from './summary';
import { WindowRenderer } from './windowedRenderer';

export class StatusRenderer {
  private rootPath: string;
  private renderer: WindowRenderer;
  private runningModules = new Map<string, TestResult[]>();
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
    const summary = [];
    for (const module of this.runningModules.keys()) {
      const relativePath = relative(this.rootPath, module);
      summary.push(
        `${color.bgYellow(color.bold(' RUNS '))} ${prettyTestPath(relativePath)}`,
      );
    }
    summary.push('');

    if (this.testModules.length === 0) {
      summary.push(
        `${color.gray('Test Files'.padStart(11))} ${this.runningModules.size} total`,
      );
    } else {
      summary.push(
        `${color.gray('Test Files'.padStart(11))} ${getSummaryStatusString(this.testModules, '', false)} ${color.dim('|')} ${this.runningModules.size + this.testModules.length} total`,
      );
    }

    const testResults: TestResult[] = Array.from(this.runningModules.values())
      .flat()
      .concat(this.testModules.flatMap((mod) => mod.results));

    if (testResults.length) {
      summary.push(
        `${color.gray('Tests'.padStart(11))} ${getSummaryStatusString(testResults, '', false)}`,
      );
    }

    summary.push(
      `${color.gray('Duration'.padStart(11))} ${prettyTime(Date.now() - this.startTime!)}`,
    );

    summary.push('');

    return summary;
  }

  onTestFileStart(testPath: string): void {
    this.runningModules.set(testPath, []);
    this.renderer?.schedule();
  }

  onTestCaseResult(result: TestResult): void {
    this.runningModules.set(result.testPath, [
      ...(this.runningModules.get(result.testPath) || []),
      result,
    ]);
  }

  onTestFileResult(test: TestFileResult): void {
    this.runningModules.delete(test.testPath);
    this.testModules.push(test);
    this.renderer?.schedule();
  }

  clear(): void {
    this.testModules.length = 0;
    this.runningModules.clear();
    this.renderer?.finish();
  }
}
