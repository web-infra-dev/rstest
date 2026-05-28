import { createRuntimeAPI } from '../../src/runtime/runner/runtime';
import type { RuntimeConfig, TestCase, TestSuite } from '../../src/types';
import { generateFilePathHash } from '../../src/utils/helper';

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

    const fileHash = generateFilePathHash('rstest', __filename);
    expect(tests.map((test) => test.testId)).toEqual([
      `${fileHash}_0`,
      `${fileHash}_1`,
      `${fileHash}_2`,
    ]);

    expect((tests[0] as TestSuite).tests.map((test) => test.name)).toEqual([
      'test - 0',
      'test - 1',
    ]);

    // Verify nested testId format: fileHash_suiteIdx_childIdx
    expect((tests[0] as TestSuite).tests.map((test) => test.testId)).toEqual([
      `${fileHash}_0_0`,
      `${fileHash}_0_1`,
    ]);

    expect(
      ((tests[0] as TestSuite).tests[1] as TestSuite).tests.map(
        (test) => test.testId,
      ),
    ).toEqual([`${fileHash}_0_1_0`]);

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

  describe('TestOptions third argument', () => {
    const createApi = (testTimeout = 5000) =>
      createRuntimeAPI({
        testPath: __filename,
        runtimeConfig: { testTimeout } as RuntimeConfig,
        project: 'rstest',
      });

    it('treats a numeric third arg as timeout shorthand', async () => {
      const { api, instance } = createApi();
      api.it('case', () => {}, 250);

      const [first] = await instance.getTests();
      const testCase = first as TestCase;
      expect(testCase.type).toBe('case');
      expect(testCase.timeout).toBe(250);
      expect(testCase.retry).toBeUndefined();
      expect(testCase.repeats).toBeUndefined();
    });

    it('reads timeout/retry/repeats from a TestOptions object', async () => {
      const { api, instance } = createApi();
      api.it('case', () => {}, { timeout: 250, retry: 2, repeats: 3 });

      const testCase = (await instance.getTests())[0] as TestCase;
      expect(testCase.timeout).toBe(250);
      expect(testCase.retry).toBe(2);
      expect(testCase.repeats).toBe(3);
    });

    it('falls back to config.testTimeout when timeout omitted', async () => {
      const { api, instance } = createApi(123);
      api.it('case', () => {}, { retry: 1 });

      const testCase = (await instance.getTests())[0] as TestCase;
      expect(testCase.timeout).toBe(123);
      expect(testCase.retry).toBe(1);
    });

    it('propagates options through test.each', async () => {
      const { api, instance } = createApi();
      api.it.each([1, 2])('case %s', () => {}, { timeout: 50, retry: 1 });

      const cases = (await instance.getTests()) as TestCase[];
      expect(cases).toHaveLength(2);
      for (const c of cases) {
        expect(c.timeout).toBe(50);
        expect(c.retry).toBe(1);
      }
    });

    it('propagates options through test.for', async () => {
      const { api, instance } = createApi();
      api.it.for([1, 2])('case %s', () => {}, { timeout: 50, repeats: 2 });

      const cases = (await instance.getTests()) as TestCase[];
      expect(cases).toHaveLength(2);
      for (const c of cases) {
        expect(c.timeout).toBe(50);
        expect(c.repeats).toBe(2);
      }
    });

    it('still accepts numeric shorthand on test.each / test.for', async () => {
      const { api, instance } = createApi();
      api.it.each([1])('a %s', () => {}, 99);
      api.it.for([2])('b %s', () => {}, 88);

      const [a, b] = (await instance.getTests()) as TestCase[];
      expect(a!.timeout).toBe(99);
      expect(b!.timeout).toBe(88);
    });
  });
});
