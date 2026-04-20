import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  GithubActionsReporter,
  getStepSummaryDisplayPath,
} from '../../src/reporter/githubActions';
import type { Duration, SnapshotSummary } from '../../src/types';

const emptySnapshotSummary: SnapshotSummary = {
  added: 0,
  didUpdate: false,
  failure: false,
  filesAdded: 0,
  filesRemoved: 0,
  filesRemovedList: [],
  filesUnmatched: 0,
  filesUpdated: 0,
  matched: 0,
  total: 0,
  unchecked: 0,
  uncheckedKeysByFile: [],
  unmatched: 0,
  updated: 0,
};

const emptyDuration: Duration = {
  totalTime: 0,
  buildTime: 0,
  testTime: 0,
};

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
        results: [
          {
            testId: 'file-a',
            status: 'pass',
            name: 'file-a',
            testPath: path.join(tempDir, 'packages/a/a.test.ts'),
            project: 'pkg-a',
            results: [],
          },
          {
            testId: 'file-b',
            status: 'pass',
            name: 'file-b',
            testPath: path.join(tempDir, 'packages/b/b.test.ts'),
            project: 'pkg-b',
            results: [],
          },
        ],
        testResults: [],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: () => null,
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
        results: [],
        testResults: [],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: () => null,
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
        results: [],
        testResults: [],
        duration: emptyDuration,
        snapshotSummary: emptySnapshotSummary,
        getSourcemap: () => null,
        unhandledErrors: [new Error('global setup failed')],
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
        results: [
          {
            testId: 'file-1',
            status: 'pass',
            name: 'flaky.test.ts',
            testPath,
            project: 'rstest',
            results: [],
          },
        ],
        testResults: [
          {
            testId: 'test-1',
            status: 'pass',
            name: 'retries then passes',
            parentNames: ['describe flaky'],
            testPath,
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
        getSourcemap: () => null,
      });

      const summary = await fs.readFile(summaryPath, 'utf-8');
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
});
