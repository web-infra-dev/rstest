export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: Record<string, unknown>;
};

export type BrowserHostConfig = {
  rootPath: string;
  projects: BrowserProjectRuntime[];
  snapshot: {
    updateSnapshot: unknown;
  };
  testFile?: string;
  runnerUrl?: string;
};

export type BrowserClientMessage =
  | { type: 'ready' }
  | {
      type: 'file-start';
      payload: { testPath: string; projectName: string };
    }
  | {
      type: 'file-complete';
      payload: { testPath: string; status: 'pass' | 'fail' | 'skip' };
    }
  | {
      type: 'fatal';
      payload: { message: string; stack?: string };
    }
  | { type: string; payload?: unknown };
