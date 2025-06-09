import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';

export class RstestSnapshotEnvironment extends NodeSnapshotEnvironment {
  override getHeader(): string {
    return `// Rstest Snapshot v${this.getVersion()}`;
  }
}
