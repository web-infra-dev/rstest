import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';
import { SNAPSHOT_HEADER } from '../../utils/snapshotPath';

export class RstestSnapshotEnvironment extends NodeSnapshotEnvironment {
  private readonly resolveSnapshotPath: (filepath: string) => Promise<string>;

  constructor(options: {
    resolveSnapshotPath: (filepath: string) => Promise<string>;
  }) {
    super();
    this.resolveSnapshotPath = options.resolveSnapshotPath;
  }

  override getHeader(): string {
    return `${SNAPSHOT_HEADER} v${this.getVersion()}`;
  }

  override resolvePath(filepath: string): Promise<string> {
    return this.resolveSnapshotPath(filepath);
  }
}
