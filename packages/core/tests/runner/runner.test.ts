import {
  traverseUpdateTest,
  traverseUpdateTestRunMode,
  updateTestModes,
} from '../../src/runtime/runner/task';
import type { TestCase, TestSuite } from '../../src/types';

describe('traverseUpdateTest', () => {
  describe('traverseUpdateTestRunMode', () => {
    it('should set the suite to run when some tests are run', () => {
      const testA = {
        name: 'testA',
        runMode: 'run',
        type: 'suite',
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

      traverseUpdateTestRunMode(testA as TestSuite, 'run', false);

      expect(testA.runMode).toBe('run');
    });

    it('should set the suite to skip when all tests are skip', () => {
      const testA = {
        name: 'testA',
        runMode: 'run',
        type: 'suite',
        tests: [
          {
            name: 'test-1',
            type: 'case',
            runMode: 'skip',
          },
        ],
      };

      traverseUpdateTestRunMode(testA as TestSuite, 'run', false);

      expect(testA.runMode).toBe('skip');
    });

    it('should update nested test suite run mode correctly', () => {
      const testA = {
        name: 'testA',
        runMode: 'run',
        type: 'suite',
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

      traverseUpdateTestRunMode(testA as TestSuite, 'run', false);

      expect(testA.runMode).toBe('run');
      expect(testA.tests[2]?.runMode).toBe('skip');
    });
  });

  describe('updateTestMode with only', () => {
    it('should update test run mode correctly when has only test case', () => {
      const tests: [TestSuite, TestCase] = [
        {
          name: 'testA',
          runMode: 'run',
          type: 'suite',
          tests: [
            {
              name: 'test-0',
              type: 'case',
              runMode: 'only',
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
                  runMode: 'run',
                },
                {
                  name: 'test-2-2',
                  type: 'case',
                  runMode: 'only',
                },
              ],
            },
            {
              name: 'test-4',
              type: 'suite',
              runMode: 'run',
              tests: [
                {
                  name: 'test-4-1',
                  type: 'case',
                  runMode: 'run',
                },
              ],
            },
          ],
        } as TestSuite,
        {
          name: 'testB',
          runMode: 'run',
          type: 'case',
        } as TestCase,
      ];

      updateTestModes(tests);

      expect(tests[0].runMode).toBe('run');
      expect(tests[0].tests[0]?.runMode).toBe('only');
      expect(tests[0].tests[1]?.runMode).toBe('skip');
      expect(tests[0].tests[2]?.runMode).toBe('run');
      expect((tests[0].tests[2] as TestSuite).tests[0]?.runMode).toBe('skip');
      expect((tests[0].tests[2] as TestSuite).tests[1]?.runMode).toBe('only');
      expect(tests[0].tests[3]?.runMode).toBe('skip');
      expect(tests[1].runMode).toBe('skip');
    });

    it('should update test run mode correctly when has only test suite', () => {
      const tests: [TestSuite, TestCase] = [
        {
          name: 'testA',
          runMode: 'only',
          type: 'suite',
          tests: [
            {
              name: 'test-0',
              type: 'case',
              runMode: 'run',
            },
            {
              name: 'test-1',
              type: 'suite',
              runMode: 'run',
              tests: [
                {
                  name: 'test-1-1',
                  type: 'case',
                  runMode: 'run',
                },
              ],
            },
            {
              name: 'test-2',
              type: 'suite',
              runMode: 'only',
              tests: [
                {
                  name: 'test-2-1',
                  type: 'case',
                  runMode: 'run',
                },
                {
                  name: 'test-2-2',
                  type: 'case',
                  runMode: 'skip',
                },
                {
                  name: 'test-2-3',
                  type: 'suite',
                  runMode: 'run',
                  tests: [
                    {
                      name: 'test-2-3-1',
                      type: 'case',
                      runMode: 'run',
                    },
                  ],
                },
              ],
            },
          ],
        } as TestSuite,
        {
          name: 'testB',
          runMode: 'run',
          type: 'case',
        } as TestCase,
      ];

      updateTestModes(tests);

      expect(tests[0].runMode).toBe('only');
      expect(tests[0].tests[0]?.runMode).toBe('skip');
      expect(tests[0].tests[1]?.runMode).toBe('skip');
      expect((tests[0].tests[1] as TestSuite).tests[0]?.runMode).toBe('skip');
      expect(tests[0].tests[2]?.runMode).toBe('only');
      expect((tests[0].tests[2] as TestSuite).tests[0]?.runMode).toBe('run');
      expect((tests[0].tests[2] as TestSuite).tests[1]?.runMode).toBe('skip');
      expect((tests[0].tests[2] as TestSuite).tests[2]?.runMode).toBe('run');
      expect(tests[1].runMode).toBe('skip');
    });
  });

  it('updateTestMode with testNamePattern', () => {
    const tests: [TestSuite, TestCase] = [
      {
        name: 'testA',
        runMode: 'run',
        type: 'suite',
        tests: [
          {
            name: 'test-0',
            type: 'case',
            runMode: 'run',
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
                runMode: 'run',
              },
              {
                name: 'test-2-2',
                type: 'case',
                runMode: 'run',
              },
            ],
          },
        ],
      } as TestSuite,
      {
        name: 'testB',
        runMode: 'run',
        type: 'case',
      } as TestCase,
    ];

    traverseUpdateTest(tests, /2-1/);
    expect(tests).toMatchInlineSnapshot(`
      [
        {
          "name": "testA",
          "runMode": "run",
          "tests": [
            {
              "name": "test-0",
              "parentNames": [
                "testA",
              ],
              "runMode": "skip",
              "type": "case",
            },
            {
              "name": "test-1",
              "parentNames": [
                "testA",
              ],
              "runMode": "skip",
              "type": "case",
            },
            {
              "name": "test-2",
              "runMode": "run",
              "tests": [
                {
                  "name": "test-2-1",
                  "parentNames": [
                    "testA",
                    "test-2",
                  ],
                  "runMode": "run",
                  "type": "case",
                },
                {
                  "name": "test-2-2",
                  "parentNames": [
                    "testA",
                    "test-2",
                  ],
                  "runMode": "skip",
                  "type": "case",
                },
              ],
              "type": "suite",
            },
          ],
          "type": "suite",
        },
        {
          "name": "testB",
          "parentNames": [],
          "runMode": "skip",
          "type": "case",
        },
      ]
    `);
  });
});
