import type { MaybePromise } from './utils';

export interface TestEnvironmentReturn {
  teardown: (global: any) => MaybePromise<void>;
}

export interface TestEnvironment<Global = any> {
  name: string;
  setup: (
    global: Global,
    options: Record<string, any>,
  ) => MaybePromise<TestEnvironmentReturn>;
}
