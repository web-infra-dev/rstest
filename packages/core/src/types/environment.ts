import type { MaybePromise } from './utils';

export interface TestEnvironmentReturn {
  teardown: (global: any) => MaybePromise<void>;
}
export interface TestEnvironment<Global = any, Options = Record<string, any>> {
  name: string;
  setup: (
    global: Global,
    options: Options,
  ) => MaybePromise<TestEnvironmentReturn>;
}
