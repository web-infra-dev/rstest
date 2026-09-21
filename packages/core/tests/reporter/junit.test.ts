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

  it('uses authoritative summaries and durations', async () => {
    const logs: string[] = [];
    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    const reporter = new JUnitReporter({ rootPath: '/test/root' });
    const testResult: TestResult = {
      testId: 'case-1',
      status: 'passed',
      name: 'short name',
      fullName: 'suite > authoritative name',
      testPath: '/different/root/test.test.ts',
      relativeTestPath: 'payload/test.test.ts',
      duration: 10,
      project: 'default',
    };
    const fileResult: TestFileResult = {
      ...testResult,
      testId: 'file-1',
      fullName: 'ignored file name',
      duration: 4200,
      results: [testResult],
      summary: {
        total: 9,
        passed: 2,
        failed: 3,
        skipped: 1,
        todo: 3,
        flaky: 0,
      },
    };

    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      results: [fileResult],
      testResults: [testResult],
      summary: {
        tests: {
          total: 20,
          passed: 8,
          failed: 4,
          skipped: 2,
          todo: 5,
          flaky: 1,
        },
        files: { total: 1, failed: 1 },
      },
      duration: { totalTime: 9900, buildTime: 700, testTime: 8700 },
    });

    const xml = logs.join('\n');
    expect(xml).toContain(
      '<testsuites name="rstest tests" tests="20" failures="4" errors="0" skipped="7" time="8.7"',
    );
    expect(xml).toContain(
      '<testsuite name="payload/test.test.ts" tests="9" failures="3" errors="0" skipped="4" time="4.2"',
    );
    expect(xml).toContain(
      '<testcase name="suite &gt; authoritative name" classname="payload/test.test.ts" time="0.01">',
    );
  });

  it('reports escaped unhandled errors as suite stderr', async () => {
    const logs: string[] = [];
    rs.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    const reporter = new JUnitReporter({ rootPath: '/test/root' });
    await reporter.onTestRunEnd({
      ...emptyRunEndPayload,
      unhandledErrors: [
        {
          name: 'UnhandledError',
          message: 'crashed <before> & after',
          stack:
            'UnhandledError: crashed <before> & after\n    at setup.ts:1:1',
        },
      ],
    });

    const xml = logs.join('\n');
    expect(xml).toContain('errors="1"');
    expect(xml).toContain('<testsuite name="rstest unhandled errors"');
    expect(xml).toContain(
      '<system-err>UnhandledError: crashed &lt;before&gt; &amp; after',
    );
    expect(xml).not.toContain('crashed <before> & after');
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
