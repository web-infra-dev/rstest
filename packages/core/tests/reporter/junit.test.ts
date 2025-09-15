import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { JUnitReporter } from '../../src/reporter/junit';
import type { Duration, TestFileResult, TestResult } from '../../src/types';

describe('JUnitReporter', () => {
  it('should create JUnit XML report correctly', async () => {
    const reporter = new JUnitReporter({
      rootPath: '/test/root',
      options: {},
    });

    const mockTestResults: TestResult[] = [
      {
        status: 'pass',
        name: 'should pass',
        testPath: '/test/root/test1.test.ts',
        duration: 100,
        project: 'default',
      },
      {
        status: 'fail',
        name: 'should fail',
        testPath: '/test/root/test1.test.ts',
        duration: 200,
        errors: [
          {
            message: 'Test failed',
            name: 'AssertionError',
            stack:
              'Error: Test failed\n    at test (/test/root/test1.test.ts:10:5)',
          },
        ],
        project: 'default',
      },
      {
        status: 'skip',
        name: 'should skip',
        testPath: '/test/root/test1.test.ts',
        duration: 0,
        project: 'default',
      },
    ];

    const mockFileResults: TestFileResult[] = [
      {
        status: 'fail',
        name: 'test1.test.ts',
        testPath: '/test/root/test1.test.ts',
        duration: 300,
        results: mockTestResults,
        project: 'default',
      },
    ];

    const mockDuration: Duration = {
      totalTime: 500,
      buildTime: 100,
      testTime: 300,
    };

    // Mock console.log to capture output
    const logs: string[] = [];

    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    onTestFinished(() => {
      rs.resetAllMocks();
    });

    await reporter.onTestRunEnd({
      results: mockFileResults,
      testResults: mockTestResults,
      duration: mockDuration,
      getSourcemap: () => null,
    });

    // Verify that XML was generated
    expect(
      logs.some((log) =>
        log.includes('<?xml version="1.0" encoding="UTF-8"?>'),
      ),
    ).toBe(true);
    expect(logs.some((log) => log.includes('<testsuites'))).toBe(true);
    expect(logs.some((log) => log.includes('<testsuite'))).toBe(true);
    expect(logs.some((log) => log.includes('<testcase'))).toBe(true);
    expect(logs.some((log) => log.includes('should pass'))).toBe(true);
    expect(logs.some((log) => log.includes('should fail'))).toBe(true);
    expect(logs.some((log) => log.includes('should skip'))).toBe(true);
    expect(logs.some((log) => log.includes('<failure'))).toBe(true);
    expect(logs.some((log) => log.includes('<skipped'))).toBe(true);
  });

  it('should handle empty test results', async () => {
    // Mock console.log to capture output
    const logs: string[] = [];

    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    onTestFinished(() => {
      rs.resetAllMocks();
    });

    const reporter = new JUnitReporter({
      rootPath: '/test/root',
      options: {},
    });

    const mockDuration: Duration = {
      totalTime: 0,
      buildTime: 0,
      testTime: 0,
    };

    await reporter.onTestRunEnd({
      results: [],
      testResults: [],
      duration: mockDuration,
      getSourcemap: () => null,
    });

    expect(logs.some((log) => log.includes('tests="0"'))).toBe(true);
    expect(logs.some((log) => log.includes('failures="0"'))).toBe(true);
  });

  it('should escape XML special characters', async () => {
    // Mock console.log to capture output
    const logs: string[] = [];

    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    const reporter = new JUnitReporter({
      rootPath: '/test/root',
    });

    const mockTestResults: TestResult[] = [
      {
        status: 'fail',
        name: 'test with <xml> & "quotes" & \'apos\'',
        testPath: '/test/root/test.test.ts',
        duration: 100,
        errors: [
          {
            message: 'Error with <xml> & "quotes" & \'apos\'',
            name: 'TestError',
            stack: 'Error: <xml> & "quotes" & \'apos\'',
          },
        ],
        project: 'default',
      },
    ];

    const mockFileResults: TestFileResult[] = [
      {
        status: 'fail',
        name: 'test.test.ts',
        testPath: '/test/root/test.test.ts',
        duration: 100,
        results: mockTestResults,
        project: 'default',
      },
    ];

    const mockDuration: Duration = {
      totalTime: 100,
      buildTime: 0,
      testTime: 100,
    };

    await reporter.onTestRunEnd({
      results: mockFileResults,
      testResults: mockTestResults,
      duration: mockDuration,
      getSourcemap: () => null,
    });

    // Verify XML is properly escaped
    expect(logs.some((log) => log.includes('&lt;xml&gt;'))).toBe(true);
    expect(logs.some((log) => log.includes('&amp;'))).toBe(true);
    expect(logs.some((log) => log.includes('&quot;'))).toBe(true);
    expect(logs.some((log) => log.includes('&apos;'))).toBe(true);
    expect(logs.some((log) => log.includes('<xml>'))).toBe(false); // Should not contain unescaped XML
  });
});
