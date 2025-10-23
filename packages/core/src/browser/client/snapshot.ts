const SNAPSHOT_HEADER = '// Rstest Snapshot';

export class BrowserSnapshotEnvironment {
  private storage = new Map<string, string>();

  getVersion(): string {
    return '1';
  }

  getHeader(): string {
    return `${SNAPSHOT_HEADER}`;
  }

  async resolveRawPath(_testPath: string, rawPath: string): Promise<string> {
    return rawPath;
  }

  async resolvePath(filepath: string): Promise<string> {
    return `${filepath}.snap`;
  }

  async prepareDirectory(): Promise<void> {
    // no-op in browser
  }

  async saveSnapshotFile(filepath: string, snapshot: string): Promise<void> {
    this.storage.set(filepath, snapshot);
  }

  async readSnapshotFile(filepath: string): Promise<string | null> {
    return this.storage.has(filepath)
      ? this.storage.get(filepath)!
      : null;
  }

  async removeSnapshotFile(filepath: string): Promise<void> {
    this.storage.delete(filepath);
  }
}
