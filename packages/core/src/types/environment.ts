import type { MaybePromise } from './utils';

export interface TestEnvironmentReturn {
  teardown: (global: any) => MaybePromise<void>;
}

export interface TestEnvironment {
  name: string;
  setup: (
    global: any,
    options: Record<string, any>,
  ) => MaybePromise<TestEnvironmentReturn>;
}
