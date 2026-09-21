import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  GithubActionsReporter,
  getStepSummaryDisplayPath,
} from '../../src/reporter/githubActions';
import {
  emptyDuration,
  emptyRunEndPayload,
  emptySnapshotSummary,
} from './helpers';

describe('getStepSummaryDisplayPath', () => {
  it('uses a placeholder for the workspace root', () => {
    expect(
      getStepSummaryDisplayPath(
        '/home/runner/work/rstest/rstest',
        '/home/runner/work/rstest/rstest',
      ),
    ).toBe('<ROOT>');
  });

  it('returns a workspace-relative path for nested directories', () => {
    expect(
      getStepSummaryDisplayPath(
        '/home/runner/work/rstest/rstest/examples/node',
        '/home/runner/work/rstest/rstest',
      ),
    ).toBe('<ROOT>/examples/node');
  });

  it('normalizes Windows separators and drive letter casing', () => {
    expect(
      getStepSummaryDisplayPath(
        'D:/a/rstest/rstest/examples/node',
        'd:\\a\\rstest\\rstest',
      ),
    ).toBe('<ROOT>/examples/node');

    expect(
      getStepSummaryDisplayPath(
        'D:\\a\\rstest\\rstest\\examples\\react-rsbuild',
        'd:/a/rstest/rstest',
      ),
    ).toBe('<ROOT>/examples/react-rsbuild');
  });

  it('falls back to the normalized absolute path outside the workspace', () => {
    expect(
      getStepSummaryDisplayPath(
        'D:\\external\\rstest\\examples\\node',
        'd:/a/rstest/rstest',
      ),
    ).toBe('D:/external/rstest/examples/node');
  });
});

describe('GithubActionsReporter step summary', () => {
  it('prefers the root config name when multiple project names are present', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        config: {
          name: 'rstest:unit',
        },
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });

      await reporter.onTestRunEnd({
        ...emptyRunEndPayload,
        results: [
          {
            testId: 'file-a',
            status: 'passed',
            name: 'file-a',
            fullName: 'file-a',
            testPath: path.join(tempDir, 'packages/a/a.test.ts'),
            relativeTestPath: 'packages/a/a.test.ts',
            project: 'pkg-a',
            results: [],
            summary: {
              total: 0,
              passed: 0,
              failed: 0,
              skipped: 0,
              todo: 0,
              flaky: 0,
            },
          },
          {
            testId: 'file-b',
            status: 'passed',
            name: 'file-b',
            fullName: 'file-b',
            testPath: path.join(tempDir, 'packages/b/b.test.ts'),
            relativeTestPath: 'packages/b/b.test.ts',
            project: 'pkg-b',
            results: [],
            summary: {
              total: 0,
              passed: 0,
              failed: 0,
              skipped: 0,
              todo: 0,
              flaky: 0,
            },
          },
        ],
        testResults: [],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: async () => null,
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
      expect(summary).toContain(
        '<summary>Rstest Test Reporter (rstest:unit) ✅</summary>',
      );
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('renders the root placeholder as inline code in markdown', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });

      await reporter.onTestRunEnd({
        ...emptyRunEndPayload,
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
      expect(summary).toContain('> Under path: `<ROOT>`');
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('marks summaries with unhandled errors as failed', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });

      await reporter.onTestRunEnd({
        ...emptyRunEndPayload,
        status: 'error',
        unhandledErrors: [{ name: 'Error', message: 'global setup failed' }],
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
      expect(summary).toContain('<summary>Rstest Test Reporter ❌</summary>');
      expect(summary).toContain('### ❌ FAIL Unhandled Error 1');
      expect(summary).toContain('**Error**: global setup failed');
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the configured summary field length without changing the default', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const defaultSummaryPath = path.join(tempDir, 'default-summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;
    const testPath = path.join(tempDir, 'tests/long-diff.test.ts');
    const diff = [
      '- Expected',
      '+ Received',
      '',
      '- expected first line',
      ...Array.from(
        { length: 40 },
        (_, index) => `  unchanged context line ${index}`,
      ),
      '+ received last line',
    ].join('\n');

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
          summary: {
            maxCharsPerField: 2_000,
          },
        },
      });

      const runEndPayload: Parameters<
        GithubActionsReporter['onTestRunEnd']
      >[0] = {
        ...emptyRunEndPayload,
        status: 'failed',
        results: [
          {
            testId: 'file-1',
            status: 'failed',
            name: 'long-diff.test.ts',
            fullName: 'long-diff.test.ts',
            testPath,
            relativeTestPath: 'tests/long-diff.test.ts',
            project: 'rstest',
            results: [],
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              skipped: 0,
              todo: 0,
              flaky: 0,
            },
          },
        ],
        testResults: [
          {
            testId: 'test-1',
            status: 'failed',
            name: 'shows the useful diff',
            fullName: 'shows the useful diff',
            parentNames: [],
            testPath,
            relativeTestPath: 'tests/long-diff.test.ts',
            project: 'rstest',
            errors: [
              {
                name: 'AssertionError',
                message: 'values differ',
                diff,
              },
            ],
          },
        ],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: async () => null,
      };

      await reporter.onTestRunEnd(runEndPayload);

      process.env.GITHUB_STEP_SUMMARY = defaultSummaryPath;
      const defaultReporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });
      await defaultReporter.onTestRunEnd(runEndPayload);

      const summary = await fs.readFile(summaryPath, 'utf-8');
      const defaultSummary = await fs.readFile(defaultSummaryPath, 'utf-8');
      expect(summary).toContain('- expected first line');
      expect(summary).toContain('+ received last line');
      expect(defaultSummary).toContain('- expected first line');
      expect(defaultSummary).not.toContain('+ received last line');
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('renders flaky tests with a short summary of previous failures', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;
    const testPath = path.join(tempDir, 'tests/flaky.test.ts');

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });

      await reporter.onTestRunEnd({
        ...emptyRunEndPayload,
        summary: {
          files: { total: 1, failed: 0 },
          tests: {
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            todo: 0,
            flaky: 1,
          },
        },
        results: [
          {
            testId: 'file-1',
            status: 'passed',
            name: 'flaky.test.ts',
            fullName: 'flaky.test.ts',
            testPath,
            relativeTestPath: 'tests/flaky.test.ts',
            project: 'rstest',
            results: [],
            summary: {
              total: 1,
              passed: 1,
              failed: 0,
              skipped: 0,
              todo: 0,
              flaky: 1,
            },
          },
        ],
        testResults: [
          {
            testId: 'test-1',
            status: 'passed',
            name: 'retries then passes',
            fullName: 'describe flaky > retries then passes',
            parentNames: ['describe flaky'],
            testPath,
            relativeTestPath: 'tests/flaky.test.ts',
            project: 'rstest',
            retryCount: 2,
            errors: [
              {
                name: 'AssertionError',
                message: 'expected 1 to be 2\n\nExpected: 2\nReceived: 1',
              },
            ],
          },
        ],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: async () => null,
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
      expect(summary).toContain('<details open>');
      expect(summary).toContain('<summary>Rstest Test Reporter ⚠️</summary>');
      expect(summary).toContain('| **Flaky Tests** | 1 passed after retry |');
      expect(summary).toContain('## Flaky Tests');
      expect(summary).toContain(
        '- `tests/flaky.test.ts > describe flaky > retries then passes` (passed after retry x2)',
      );
      expect(summary).toContain(
        'Previous failure: AssertionError: expected 1 to be 2 Expected: 2 Received: 1',
      );
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('labels retry errors by attempt in the failure details', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-gha-'));
    const summaryPath = path.join(tempDir, 'summary.md');
    const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    const previousWorkspacePath = process.env.GITHUB_WORKSPACE;
    const testPath = path.join(tempDir, 'tests/retry.test.ts');

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    process.env.GITHUB_WORKSPACE = tempDir;

    try {
      const reporter = new GithubActionsReporter({
        rootPath: tempDir,
        options: {
          onWritePath: (value) => value,
          annotations: false,
        },
      });

      await reporter.onTestRunEnd({
        ...emptyRunEndPayload,
        status: 'failed',
        results: [
          {
            testId: 'file-1',
            status: 'failed',
            name: 'retry.test.ts',
            fullName: 'retry.test.ts',
            testPath,
            relativeTestPath: 'tests/retry.test.ts',
            project: 'rstest',
            results: [],
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              skipped: 0,
              todo: 0,
              flaky: 0,
            },
          },
        ],
        testResults: [
          {
            testId: 'test-1',
            status: 'failed',
            name: 'fails after retries',
            fullName: 'describe retry > fails after retries',
            parentNames: ['describe retry'],
            testPath,
            relativeTestPath: 'tests/retry.test.ts',
            project: 'rstest',
            retryCount: 1,
            errors: [
              {
                name: 'AssertionError',
                message: 'first failure',
                retryCount: 0,
              },
              {
                name: 'AssertionError',
                message: 'retry failure',
                retryCount: 1,
              },
            ],
          },
        ],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: async () => null,
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
      expect(summary).toContain('## Failures');
      expect(summary).toContain(
        '### ❌ FAIL tests/retry.test.ts > describe retry > fails after retries (retry x1)',
      );
      expect(summary).toContain('**AssertionError**: first failure');
      expect(summary).toContain('**Retry x1 - AssertionError**: retry failure');
    } finally {
      if (previousSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
      }

      if (previousWorkspacePath === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previousWorkspacePath;
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
