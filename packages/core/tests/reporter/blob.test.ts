import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { join } from 'pathe';
import {
  blobFileKey,
  blobFileName,
  BlobReporter,
  isBlobFile,
} from '../../src/reporter/blob';
import type {
  NormalizedConfig,
  SnapshotSummary,
  TestResult,
  UserConsoleLog,
} from '../../src/types';

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

describe('blob wire-format', () => {
  it('names the unsharded blob deterministically', () => {
    expect(blobFileName()).toBe('blob.json');
    expect(blobFileName(undefined)).toBe('blob.json');
  });

  it('encodes the shard index/count into the filename', () => {
    expect(blobFileName({ index: 1, count: 4 })).toBe('blob-1-4.json');
    expect(blobFileName({ index: 12, count: 30 })).toBe('blob-12-30.json');
  });

  it('round-trips: every name the writer emits is recognized by the reader', () => {
    expect(isBlobFile(blobFileName())).toBe(true);
    expect(isBlobFile(blobFileName({ index: 2, count: 3 }))).toBe(true);
  });

  it('rejects unrelated and malformed filenames', () => {
    expect(isBlobFile('blob.txt')).toBe(false);
    expect(isBlobFile('report.json')).toBe(false);
    expect(isBlobFile('blob-1.json')).toBe(false);
    expect(isBlobFile('blob-1-2-3.json')).toBe(false);
    expect(isBlobFile('prefix-blob.json')).toBe(false);
    expect(isBlobFile('blob-a-b.json')).toBe(false);
  });
});

describe('blob event track', () => {
  it('file-start replaces the track, so a watch rerun records the file anew', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'rstest-blob-'));
    onTestFinished(() => {
      rmSync(outputDir, { recursive: true, force: true });
    });

    const reporter = new BlobReporter({
      rootPath: outputDir,
      config: { shard: undefined } as NormalizedConfig,
    });

    const fileStart = () => {
      reporter.onTestFileStart({
        testId: 'file:/a.test.ts',
        testPath: '/a.test.ts',
        project: 'p',
        tests: [],
      });
    };
    const caseResult = (name: string): TestResult => ({
      testId: `case-${name}`,
      status: 'pass',
      name,
      testPath: '/a.test.ts',
      project: 'p',
    });
    const log: UserConsoleLog = {
      content: 'first run',
      name: 'log',
      testPath: '/a.test.ts',
      project: 'p',
      type: 'stdout',
    };

    // First run of the file, then a watch rerun of the same file.
    fileStart();
    reporter.onUserConsoleLog(log);
    reporter.onTestCaseResult(caseResult('first'));
    fileStart();
    reporter.onTestCaseResult(caseResult('rerun'));

    await reporter.onTestRunEnd({
      results: [],
      testResults: [],
      duration: { totalTime: 0, buildTime: 0, testTime: 0 },
      snapshotSummary: emptySnapshotSummary,
    });

    const blob = JSON.parse(
      readFileSync(join(outputDir, '.rstest-reports', 'blob.json'), 'utf-8'),
    ) as { files: Record<string, { events: unknown[] }> };
    // Only the rerun's events survive — replaying both runs' events against
    // the file's single (latest) result would double every lifecycle hook.
    expect(blob.files[blobFileKey('p', '/a.test.ts')]?.events).toEqual([
      { h: 'start' },
      { h: 'caseResult', id: 'case-rerun' },
    ]);
  });
});
