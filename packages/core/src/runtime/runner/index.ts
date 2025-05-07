import type {
  DescribeAPI,
  DescribeBaseAPI,
  DescribeEachFn,
  Rstest,
  RunnerAPI,
  RunnerHooks,
  TestAPI,
  TestBaseAPI,
  TestEachFn,
  TestFileResult,
  WorkerState,
} from '../../types';

import { TestRunner } from './runner';
import { RunnerRuntime } from './runtime';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      hooks: RunnerHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    getCurrentTest: TestRunner['getCurrentTest'];
  };
} {
  const {
    sourcePath,
    runtimeConfig: { testTimeout },
  } = workerState;
  const runtimeAPI: RunnerRuntime = new RunnerRuntime({
    sourcePath,
    testTimeout,
  });
  const testRunner: TestRunner = new TestRunner();

  // TODO: optimize chainable API

  const it = ((name, fn, timeout) =>
    runtimeAPI.it(name, fn, timeout)) as TestAPI;
  it.fails = runtimeAPI.fails.bind(runtimeAPI);
  it.each = runtimeAPI.each.bind(runtimeAPI) as TestEachFn;
  it.todo = (name, fn, timeout) => runtimeAPI.it(name, fn, timeout, 'todo');

  it.skip = ((name, fn, timeout) =>
    runtimeAPI.it(name, fn, timeout, 'skip')) as TestBaseAPI;
  it.skip.fails = (name, fn, timeout) =>
    runtimeAPI.fails(name, fn, timeout, 'skip');
  it.skip.each = ((cases: any) => runtimeAPI.each(cases, 'skip')) as TestEachFn;

  it.only = ((name, fn, timeout) =>
    runtimeAPI.it(name, fn, timeout, 'only')) as TestBaseAPI;
  it.only.fails = (name, fn, timeout) =>
    runtimeAPI.fails(name, fn, timeout, 'only');
  it.only.each = ((cases: any) => runtimeAPI.each(cases, 'only')) as TestEachFn;

  it.runIf = (condition: boolean) => (condition ? it : it.skip) as TestBaseAPI;
  it.skipIf = (condition: boolean) => (condition ? it.skip : it) as TestBaseAPI;

  const describe = ((name, fn) => runtimeAPI.describe(name, fn)) as DescribeAPI;

  describe.only = ((name, fn) =>
    runtimeAPI.describe(name, fn, 'only')) as DescribeBaseAPI;
  describe.only.each = ((cases: any) =>
    runtimeAPI.describeEach(cases, 'only')) as DescribeEachFn;
  describe.todo = (name, fn) => runtimeAPI.describe(name, fn, 'todo');
  describe.skip = ((name, fn) =>
    runtimeAPI.describe(name, fn, 'skip')) as DescribeBaseAPI;
  describe.skip.each = ((cases: any) =>
    runtimeAPI.describeEach(cases, 'skip')) as DescribeEachFn;

  describe.skipIf = (condition: boolean) =>
    (condition ? describe.skip : describe) as DescribeBaseAPI;
  describe.runIf = (condition: boolean) =>
    (condition ? describe : describe.skip) as DescribeBaseAPI;

  describe.each = runtimeAPI.describeEach.bind(runtimeAPI) as DescribeEachFn;

  return {
    api: {
      describe,
      it,
      test: it,
      afterAll: runtimeAPI.afterAll.bind(runtimeAPI),
      beforeAll: runtimeAPI.beforeAll.bind(runtimeAPI),
      afterEach: runtimeAPI.afterEach.bind(runtimeAPI),
      beforeEach: runtimeAPI.beforeEach.bind(runtimeAPI),
    },
    runner: {
      runTest: async (testPath: string, hooks: RunnerHooks, api: Rstest) => {
        const tests = await runtimeAPI.getTests();
        return testRunner.runTests({
          tests,
          testPath,
          state: workerState,
          hooks,
          api,
        });
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
    },
  };
}
