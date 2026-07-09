import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';

export class RstestSnapshotEnvironment extends NodeSnapshotEnvironment {
  private readonly resolveSnapshotPath: (filepath: string) => Promise<string>;

  constructor(options: {
    resolveSnapshotPath: (filepath: string) => Promise<string>;
  }) {
    super();
    this.resolveSnapshotPath = options.resolveSnapshotPath;
  }

  override getHeader(): string {
    return `// Rstest Snapshot v${this.getVersion()}`;
  }

  override resolvePath(filepath: string): Promise<string> {
    return this.resolveSnapshotPath(filepath);
  }
}
