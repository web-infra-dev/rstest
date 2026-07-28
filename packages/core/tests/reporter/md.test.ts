import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { MdReporter, resolveOptions } from '../../src/reporter/md';
import type {
  Duration,
  NormalizedConfig,
  RstestTestState,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../../src/types';
import { emptySnapshotSummary } from './helpers';

describe('resolveOptions', () => {
  describe('defaults', () => {
    it('returns default options when no input provided', () => {
      const result = resolveOptions();

      expect(result).toEqual({
        preset: 'normal',
        header: { env: true },
        reproduction: 'file+name',
        testLists: 'auto',
        failures: { max: 50 },
        codeFrame: { enabled: true, linesAbove: 2, linesBelow: 2 },
        stack: 'top',
        candidateFiles: { enabled: true, max: 5 },
        console: {
          enabled: true,
          maxLogsPerTestPath: 10,
          maxCharsPerEntry: 500,
        },
        errors: { unhandled: true },
      });
    });
  });

  describe('preset: compact', () => {
    it('applies compact preset defaults', () => {
      const result = resolveOptions({ preset: 'compact' });

      expect(result.preset).toBe('compact');
      expect(result.console.enabled).toBe(false);
      expect(result.codeFrame.enabled).toBe(false);
      expect(result.failures.max).toBe(20);
      expect(result.stack).toBe('top');
    });
  });

  describe('preset: full', () => {
    it('applies full preset defaults', () => {
      const result = resolveOptions({ preset: 'full' });

      expect(result.preset).toBe('full');
      expect(result.stack).toBe('full');
      expect(result.console.maxLogsPerTestPath).toBe(200);
      expect(result.console.maxCharsPerEntry).toBe(5000);
      expect(result.failures.max).toBe(200);
      expect(result.codeFrame.linesAbove).toBe(3);
      expect(result.codeFrame.linesBelow).toBe(3);
    });
  });

  describe('header', () => {
    it('disables env when header is false', () => {
      const result = resolveOptions({ header: false });
      expect(result.header.env).toBe(false);
    });

    it('uses default when header is true', () => {
      const result = resolveOptions({ header: true });
      expect(result.header.env).toBe(true);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ header: { env: false } });
      expect(result.header.env).toBe(false);
    });
  });

  describe('reproduction', () => {
    it('disables reproduction when false', () => {
      const result = resolveOptions({ reproduction: false });
      expect(result.reproduction).toBe(false);
    });

    it('uses file mode', () => {
      const result = resolveOptions({ reproduction: 'file' });
      expect(result.reproduction).toBe('file');
    });

    it('uses file+name mode by default', () => {
      const result = resolveOptions({});
      expect(result.reproduction).toBe('file+name');
    });
  });

  describe('failures', () => {
    it('uses preset max when not specified', () => {
      const result = resolveOptions({ preset: 'compact' });
      expect(result.failures.max).toBe(20);
    });

    it('overrides preset max with user value', () => {
      const result = resolveOptions({
        preset: 'compact',
        failures: { max: 100 },
      });
      expect(result.failures.max).toBe(100);
    });
  });

  describe('codeFrame', () => {
    it('disables codeFrame when false', () => {
      const result = resolveOptions({ codeFrame: false });
      expect(result.codeFrame.enabled).toBe(false);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ codeFrame: { linesAbove: 5 } });
      expect(result.codeFrame.enabled).toBe(true);
      expect(result.codeFrame.linesAbove).toBe(5);
      expect(result.codeFrame.linesBelow).toBe(2);
    });

    it('uses preset values', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.codeFrame.linesAbove).toBe(3);
      expect(result.codeFrame.linesBelow).toBe(3);
    });
  });

  describe('stack', () => {
    it('uses preset stack mode', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.stack).toBe('full');
    });

    it('overrides preset with user value', () => {
      const result = resolveOptions({ preset: 'full', stack: 'top' });
      expect(result.stack).toBe('top');
    });

    it('allows numeric limit', () => {
      const result = resolveOptions({ stack: 10 });
      expect(result.stack).toBe(10);
    });

    it('allows disabling stack', () => {
      const result = resolveOptions({ stack: false });
      expect(result.stack).toBe(false);
    });
  });

  describe('candidateFiles', () => {
    it('disables when false', () => {
      const result = resolveOptions({ candidateFiles: false });
      expect(result.candidateFiles.enabled).toBe(false);
    });

    it('allows max override', () => {
      const result = resolveOptions({ candidateFiles: { max: 10 } });
      expect(result.candidateFiles.enabled).toBe(true);
      expect(result.candidateFiles.max).toBe(10);
    });
  });

  describe('console', () => {
    it('disables when false', () => {
      const result = resolveOptions({ console: false });
      expect(result.console.enabled).toBe(false);
    });

    it('uses preset values', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.console.maxLogsPerTestPath).toBe(200);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ console: { maxCharsPerEntry: 1000 } });
      expect(result.console.enabled).toBe(true);
      expect(result.console.maxCharsPerEntry).toBe(1000);
      expect(result.console.maxLogsPerTestPath).toBe(10);
    });
  });

  describe('errors', () => {
    it('disables unhandled when false', () => {
      const result = resolveOptions({ errors: false });
      expect(result.errors.unhandled).toBe(false);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ errors: { unhandled: false } });
      expect(result.errors.unhandled).toBe(false);
    });
  });
});

const ROOT_PATH = '/test/root';
const PATH_A = `${ROOT_PATH}/a.test.ts`;
const PATH_B = `${ROOT_PATH}/b.test.ts`;

const emptyDuration: Duration = {
  totalTime: 0,
  buildTime: 0,
  testTime: 0,
};

const createConsoleLog = (
  testPath: string,
  content: string,
): UserConsoleLog => ({
  content,
  name: 'log',
  testPath,
  project: 'default',
  type: 'stdout',
});

const createFailedTest = (testPath: string, name: string): TestResult => ({
  testId: `${testPath}#${name}`,
  status: 'fail',
  name,
  testPath,
  project: 'default',
  errors: [{ message: `${name} failed` }],
});

const createFailedFile = (
  testPath: string,
  results: TestResult[],
): TestFileResult => ({
  testId: testPath,
  status: 'fail',
  name: testPath,
  testPath,
  project: 'default',
  results,
});

describe('MdReporter watch reruns', () => {
  it('keeps only the latest console logs per test path and reports session-wide failures', async () => {
    const reporter = new MdReporter({
      rootPath: ROOT_PATH,
      config: {} as NormalizedConfig,
      options: { header: false, reproduction: false, codeFrame: false },
      testState: {} as RstestTestState,
    });

    const output: string[] = [];
    rs.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    onTestFinished(() => {
      rs.restoreAllMocks();
    });

    const fileStart = (testPath: string) =>
      reporter.onTestFileStart({
        testId: testPath,
        testPath,
        project: 'default',
        tests: [],
      });

    fileStart(PATH_A);
    reporter.onUserConsoleLog(createConsoleLog(PATH_A, 'a first cycle'));
    fileStart(PATH_B);
    reporter.onUserConsoleLog(createConsoleLog(PATH_B, 'b only cycle'));

    // Watch rerun of file A only.
    fileStart(PATH_A);
    reporter.onUserConsoleLog(createConsoleLog(PATH_A, 'a second cycle'));

    const testA = createFailedTest(PATH_A, 'fails in a');
    const testB = createFailedTest(PATH_B, 'fails in b');

    await reporter.onTestRunEnd({
      results: [
        createFailedFile(PATH_A, [testA]),
        createFailedFile(PATH_B, [testB]),
      ],
      testResults: [testA, testB],
      duration: emptyDuration,
      getSourcemap: async () => null,
      snapshotSummary: emptySnapshotSummary,
      filterRerunTestPaths: [PATH_A],
    });

    const report = output.join('');

    expect(report).toContain('[stdout] log: a second cycle');
    expect(report).not.toContain('[stdout] log: a first cycle');
    expect(report).toContain('[stdout] log: b only cycle');

    expect(report).toContain('### [F01] a.test.ts :: fails in a');
    expect(report).toContain('### [F02] b.test.ts :: fails in b');
  });
});
