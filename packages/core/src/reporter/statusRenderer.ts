import { relative } from 'pathe';
import { color } from '../utils';
import { WindowRenderer } from './windowedRenderer';

export class StatusRenderer {
  private rootPath: string;
  private renderer: WindowRenderer;
  private runningModules = new Set<string>();

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
    const summary = [];
    for (const module of this.runningModules) {
      const relativePath = relative(this.rootPath, module);
      summary.push(`${color.bgYellow(color.bold(' RUNS '))} ${relativePath}`);
    }
    summary.push('');
    return summary;
  }

  addRunningModule(testPath: string): void {
    this.runningModules.add(testPath);
    this.renderer?.schedule();
  }

  removeRunningModule(testPath: string): void {
    this.runningModules.delete(testPath);
    this.renderer?.schedule();
  }

  clear(): void {
    this.runningModules.clear();
    this.renderer?.finish();
  }
}
