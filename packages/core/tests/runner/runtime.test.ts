import { RunnerRuntime } from '../../src/runner/runtime';
import type { TestSuite } from '../../src/types';

describe('RunnerRuntime', () => {
  it('should add test correctly', async () => {
    const runtime = new RunnerRuntime(__filename);

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

    const tests = await runtime.getTests();

    expect(tests.map((test) => test.description)).toEqual([
      'suite - 0',
      'suite - 1',
      'test - 2',
    ]);

    expect(
      (tests[0] as TestSuite).tests.map((test) => test.description),
    ).toEqual(['test - 0', 'test - 1']);

    expect(
      ((tests[0] as TestSuite).tests[1] as TestSuite).tests.map(
        (test) => test.description,
      ),
    ).toEqual(['test - 1 - 1']);
  });
});
