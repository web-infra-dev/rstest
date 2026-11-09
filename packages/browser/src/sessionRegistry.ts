import type { BrowserProviderContext, BrowserProviderPage } from './providers';

type RunnerSessionRecord = {
  id: string;
  testFile: string;
  projectName: string;
  browserName?: string;
  runToken: number;
  mode: 'headless-page' | 'headed-iframe';
  createdAt: number;
  context?: BrowserProviderContext;
  page?: BrowserProviderPage;
  metadata?: Record<string, unknown>;
};

type RunnerSessionInput = Omit<RunnerSessionRecord, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

/**
 * Execution target index for host scheduling.
 * Provides lookup by session id, test file, and run token without coupling to UI topology.
 */
export class RunnerSessionRegistry {
  private nextId = 0;
  private sessionsById = new Map<string, RunnerSessionRecord>();
  private sessionIdByTestFile = new Map<string, string>();

  /**
   * A shared test path belongs to every `(project, browser)` copy that runs
   * it, so the file index keys the triple; a bare path is ambiguous.
   */
  private fileIndexKey(record: {
    projectName?: string;
    browserName?: string;
    testFile: string;
  }): string {
    return `${record.projectName ?? ''}\u0000${record.browserName ?? ''}\u0000${record.testFile}`;
  }

  register(input: RunnerSessionInput): RunnerSessionRecord {
    const id = input.id ?? `runner-session-${++this.nextId}`;
    const createdAt = input.createdAt ?? Date.now();

    const record: RunnerSessionRecord = {
      ...input,
      id,
      createdAt,
    };

    this.sessionsById.set(id, record);
    this.sessionIdByTestFile.set(this.fileIndexKey(record), id);
    return record;
  }

  getById(id: string): RunnerSessionRecord | undefined {
    return this.sessionsById.get(id);
  }

  getByTestFile(
    testFile: string,
    identity?: { projectName?: string; browserName?: string },
  ): RunnerSessionRecord | undefined {
    const id = this.sessionIdByTestFile.get(
      this.fileIndexKey({ ...identity, testFile }),
    );
    if (!id) {
      return undefined;
    }
    return this.sessionsById.get(id);
  }

  list(): RunnerSessionRecord[] {
    return Array.from(this.sessionsById.values());
  }

  listByRunToken(runToken: number): RunnerSessionRecord[] {
    return this.list().filter((session) => session.runToken === runToken);
  }

  deleteById(id: string): boolean {
    const record = this.sessionsById.get(id);
    if (!record) {
      return false;
    }

    this.sessionsById.delete(id);
    const indexKey = this.fileIndexKey(record);
    if (this.sessionIdByTestFile.get(indexKey) === id) {
      this.sessionIdByTestFile.delete(indexKey);
    }
    return true;
  }

  deleteByTestFile(
    testFile: string,
    identity?: { projectName?: string; browserName?: string },
  ): boolean {
    const id = this.sessionIdByTestFile.get(
      this.fileIndexKey({ ...identity, testFile }),
    );
    if (!id) {
      return false;
    }
    return this.deleteById(id);
  }

  clear(): void {
    this.sessionsById.clear();
    this.sessionIdByTestFile.clear();
  }
}
