import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { JUnitReporter } from '../../src/reporter/junit';
import { emptyRunEndPayload } from './helpers';
import type { Duration, TestFileResult, TestResult } from '../../src/types';

describe('JUnitReporter', () => {
  it('should create JUnit XML report correctly', async () => {
    const reporter = new JUnitReporter({
      rootPath: '/test/root',
      options: {},
    });

    const mockTestResults: TestResult[] = [
      {
        testId: 'test-1',
        status: 'passed',
        name: 'should pass',
        fullName: 'should pass',
        testPath: '/test/root/test1.test.ts',
        relativeTestPath: 'test1.test.ts',
        duration: 100,
        project: 'default',
      },
      {
        testId: 'test-2',
        status: 'failed',
        name: 'should fail',
        fullName: 'should fail',
        testPath: '/test/root/test1.test.ts',
        relativeTestPath: 'test1.test.ts',
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
        testId: 'test-3',
        status: 'skipped',
        name: 'should skip',
        fullName: 'should skip',
        testPath: '/test/root/test1.test.ts',
        relativeTestPath: 'test1.test.ts',
        duration: 0,
        project: 'default',
      },
    ];

    const mockFileResults: TestFileResult[] = [
      {
        testId: 'test-4',
        status: 'failed',
        name: 'test1.test.ts',
        fullName: 'test1.test.ts',
        testPath: '/test/root/test1.test.ts',
        relativeTestPath: 'test1.test.ts',
        duration: 300,
        results: mockTestResults,
        project: 'default',
        summary: {
          total: 3,
          passed: 1,
          failed: 1,
          skipped: 1,
          todo: 0,
          flaky: 0,
        },
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
      ...emptyRunEndPayload,
      results: mockFileResults,
      testResults: mockTestResults,
      duration: mockDuration,
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
      ...emptyRunEndPayload,
      duration: mockDuration,
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
        testId: 'test-5',
        status: 'failed',
        name: 'test with <xml> & "quotes" & \'apos\'',
        fullName: 'test with <xml> & "quotes" & \'apos\'',
        testPath: '/test/root/test.test.ts',
        relativeTestPath: 'test.test.ts',
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
        testId: 'test-6',
        status: 'failed',
        name: 'test.test.ts',
        fullName: 'test.test.ts',
        testPath: '/test/root/test.test.ts',
        relativeTestPath: 'test.test.ts',
        duration: 100,
        results: mockTestResults,
        project: 'default',
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          todo: 0,
          flaky: 0,
        },
      },
    ];

    const mockDuration: Duration = {
      totalTime: 100,
      buildTime: 0,
      testTime: 100,
    };

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: mockFileResults,
      testResults: mockTestResults,
      duration: mockDuration,
    });

    // Verify XML is properly escaped
    expect(logs.some((log) => log.includes('&lt;xml&gt;'))).toBe(true);
    expect(logs.some((log) => log.includes('&amp;'))).toBe(true);
    expect(logs.some((log) => log.includes('&quot;'))).toBe(true);
    expect(logs.some((log) => log.includes('&apos;'))).toBe(true);
    expect(logs.some((log) => log.includes('<xml>'))).toBe(false); // Should not contain unescaped XML
  });
});
