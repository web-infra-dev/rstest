import { relative } from 'pathe';
import type { TestFileResult } from '../types';
import { color, prettyTestPath, prettyTime } from '../utils';
import { getSummaryStatusString } from './summary';
import { WindowRenderer } from './windowedRenderer';

export class StatusRenderer {
  private rootPath: string;
  private renderer: WindowRenderer;
  private runningModules = new Set<string>();
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
    for (const module of this.runningModules) {
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

    summary.push(
      `${color.gray('Duration'.padStart(11))} ${prettyTime(Date.now() - this.startTime!)}`,
    );

    summary.push('');

    return summary;
  }

  addRunningModule(testPath: string): void {
    this.runningModules.add(testPath);
    this.renderer?.schedule();
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
