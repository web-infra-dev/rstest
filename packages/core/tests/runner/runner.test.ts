import { traverseUpdateTestRunMode } from '../../src/runtime/runner/runner';
import type { TestSuite } from '../../src/types';

describe('traverseUpdateTestRunMode', () => {
  it('should set the suite to run when some tests are run', () => {
    const testA = {
      name: 'testA',
      runMode: 'run',
      tests: [
        {
          name: 'test-1',
          type: 'case',
          runMode: 'run',
        },
        {
          name: 'test-2',
          type: 'case',
          runMode: 'skip',
        },
      ],
    };

    traverseUpdateTestRunMode(testA as TestSuite);

    expect(testA.runMode).toBe('run');
  });

  it('should set the suite to skip when all tests are skip', () => {
    const testA = {
      name: 'testA',
      runMode: 'run',
      tests: [
        {
          name: 'test-1',
          type: 'case',
          runMode: 'skip',
        },
      ],
    };

    traverseUpdateTestRunMode(testA as TestSuite);

    expect(testA.runMode).toBe('skip');
  });

  it('should update nested test suite run mode correctly', () => {
    const testA = {
      name: 'testA',
      runMode: 'run',
      tests: [
        {
          name: 'test-1',
          type: 'case',
          runMode: 'skip',
        },
        {
          name: 'test-1',
          type: 'case',
          runMode: 'run',
        },
        {
          name: 'test-2',
          type: 'suite',
          runMode: 'run',
          tests: [
            {
              name: 'test-2-1',
              type: 'case',
              runMode: 'skip',
            },
          ],
        },
      ],
    };

    traverseUpdateTestRunMode(testA as TestSuite);

    expect(testA.runMode).toBe('run');
    expect(testA.tests[2]?.runMode).toBe('skip');
  });
});
