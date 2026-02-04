import type { BrowserProviderContext, BrowserProviderPage } from './providers';

export type RunnerSessionRecord = {
  id: string;
  testFile: string;
  projectName: string;
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

  register(input: RunnerSessionInput): RunnerSessionRecord {
    const id = input.id ?? `runner-session-${++this.nextId}`;
    const createdAt = input.createdAt ?? Date.now();

    const record: RunnerSessionRecord = {
      ...input,
      id,
      createdAt,
    };

    this.sessionsById.set(id, record);
    this.sessionIdByTestFile.set(record.testFile, id);
    return record;
  }

  getById(id: string): RunnerSessionRecord | undefined {
    return this.sessionsById.get(id);
  }

  getByTestFile(testFile: string): RunnerSessionRecord | undefined {
    const id = this.sessionIdByTestFile.get(testFile);
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
    if (this.sessionIdByTestFile.get(record.testFile) === id) {
      this.sessionIdByTestFile.delete(record.testFile);
    }
    return true;
  }

  deleteByTestFile(testFile: string): boolean {
    const id = this.sessionIdByTestFile.get(testFile);
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
