import { createRuntimeAPI } from '../../src/runtime/runner/runtime';
import type { RuntimeConfig, TestSuite } from '../../src/types';

describe('RunnerRuntime', () => {
  it('should add test correctly', async () => {
    const { api: runtime, instance } = createRuntimeAPI({
      testPath: __filename,
      runtimeConfig: { testTimeout: 100 } as RuntimeConfig,
      project: 'rstest',
    });

    runtime.describe('suite - 0', () => {
      runtime.it('test - 0', () => {});
      runtime.describe('test - 1', async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 100);
        });
        runtime.it('test - 1 - 1', () => {});
      });
    });

    runtime.describe('suite - 1', () => {});
    runtime.it('test - 2', () => {});

    const tests = await instance.getTests();

    expect(tests.map((test) => test.name)).toEqual([
      'suite - 0',
      'suite - 1',
      'test - 2',
    ]);

    expect(tests.map((test) => test.testId)).toEqual([1, 5, 6]);

    expect((tests[0] as TestSuite).tests.map((test) => test.name)).toEqual([
      'test - 0',
      'test - 1',
    ]);

    expect(
      ((tests[0] as TestSuite).tests[1] as TestSuite).tests.map(
        (test) => test.name,
      ),
    ).toEqual(['test - 1 - 1']);
  });

  it('should add test correctly when describe fn undefined', async () => {
    const { api: runtime, instance } = createRuntimeAPI({
      testPath: __filename,
      runtimeConfig: { testTimeout: 100 } as RuntimeConfig,
      project: 'rstest',
    });

    runtime.describe('suite - 0');

    runtime.describe('suite - 1', () => {
      runtime.it('test - 0', () => {});
      runtime.describe('test - 1', async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 100);
        });
        runtime.it('test - 1 - 1', () => {});
      });
    });
    runtime.it('test - 2', () => {});

    const tests = await instance.getTests();

    expect(tests.map((test) => test.name)).toEqual([
      'suite - 0',
      'suite - 1',
      'test - 2',
    ]);

    expect((tests[0] as TestSuite).tests.map((test) => test.name)).toEqual([]);

    expect((tests[1] as TestSuite).tests.map((test) => test.name)).toEqual([
      'test - 0',
      'test - 1',
    ]);

    expect(
      ((tests[1] as TestSuite).tests[1] as TestSuite).tests.map(
        (test) => test.name,
      ),
    ).toEqual(['test - 1 - 1']);
  });
});
