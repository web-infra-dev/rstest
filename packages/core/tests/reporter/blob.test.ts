import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDefaultConfig } from '../../src/config';
import { emptyRunEndPayload } from './helpers';
import { describe, expect, it } from '@rstest/core';
import {
  BLOB_TRACK_MATCHES_RUNNER_EVENTS,
  BlobReporter,
  blobFileKey,
  blobFileName,
  isBlobFile,
  parseBlobFile,
} from '../../src/reporter/blob';

describe('blob wire-format', () => {
  it('records every runner lifecycle event on the track (compile guard)', () => {
    expect(BLOB_TRACK_MATCHES_RUNNER_EVENTS).toBe(true);
  });

  it('preserves selected files even when no file result is produced', async ({
    onTestFinished,
  }) => {
    const rootPath = mkdtempSync(join(tmpdir(), 'rstest-blob-selection-'));
    onTestFinished(() => rmSync(rootPath, { recursive: true, force: true }));
    const reporter = new BlobReporter({
      rootPath,
      config: withDefaultConfig({}),
    });
    const testPath = join(rootPath, 'never-ran.test.ts');
    const runStart = {
      files: [{ testPath, project: 'project-a', testId: `file:${testPath}` }],
    };
    reporter.onTestRunStart(runStart);
    await reporter.onTestRunEnd(emptyRunEndPayload);
    const blob = parseBlobFile(
      readFileSync(join(rootPath, '.rstest-reports/blob.json'), 'utf8'),
      'blob.json',
    );
    expect(blob.runStart).toEqual(runStart);
    expect(blob.results).toEqual([]);
  });

  it('preserves verbatim log-only and fatal per-file tracks', async ({
    onTestFinished,
  }) => {
    const rootPath = mkdtempSync(join(tmpdir(), 'rstest-blob-tracks-'));
    onTestFinished(() => rmSync(rootPath, { recursive: true, force: true }));
    const reporter = new BlobReporter({
      rootPath,
      config: withDefaultConfig({}),
    });
    const log = {
      content: 'before collection',
      name: 'stderr',
      project: 'project-a',
      testPath: join(rootPath, 'log-only.test.ts'),
      relativeTestPath: 'log-only.test.ts',
      type: 'stderr' as const,
    };
    const fatal = {
      testId: 'fatal-suite',
      status: 'failed' as const,
      name: 'fatal suite',
      fullName: 'fatal suite',
      project: 'project-b',
      testPath: join(rootPath, 'fatal.test.ts'),
      relativeTestPath: 'fatal.test.ts',
      errors: [{ message: 'fatal' }],
    };

    reporter.onUserConsoleLog(log);
    const startedFile = {
      testId: `file:${log.testPath}`,
      testPath: log.testPath,
      relativeTestPath: 'log-only.test.ts',
      project: log.project,
      tests: [],
    };
    reporter.onTestFileStart(startedFile);
    reporter.onTestSuiteResult(fatal);
    await reporter.onTestRunEnd(emptyRunEndPayload);

    const blob = parseBlobFile(
      readFileSync(join(rootPath, '.rstest-reports/blob.json'), 'utf8'),
      'blob.json',
    );
    expect(blob.files[blobFileKey(log.project, log.testPath)]?.events).toEqual([
      { h: 'log', log },
      { h: 'start', test: startedFile },
    ]);
    expect(
      blob.files[blobFileKey(fatal.project, fatal.testPath)]?.events,
    ).toEqual([{ h: 'suiteResult', result: fatal }]);
  });

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

  it('names the file in the error for truncated or non-object content', () => {
    expect(() => parseBlobFile('{"version":"1', 'blob-1-2.json')).toThrow(
      /blob-1-2\.json.*not valid JSON/,
    );
    // `.*` tolerates the color escapes around the interpolated version.
    expect(() => parseBlobFile('null', 'blob.json')).toThrow(
      /uses format .*unknown/,
    );
  });

  it('rejects unrelated and malformed filenames', () => {
    expect(isBlobFile('blob.txt')).toBe(false);
    expect(isBlobFile('report.json')).toBe(false);
    expect(isBlobFile('blob-1.json')).toBe(false);
    expect(isBlobFile('blob-1-2-3.json')).toBe(false);
    expect(isBlobFile('prefix-blob.json')).toBe(false);
    expect(isBlobFile('blob-a-b.json')).toBe(false);
  });

  it('rejects both old reporter formats and other package versions', () => {
    for (const version of [RSTEST_VERSION, '0.0.0-other:2']) {
      expect(() =>
        parseBlobFile(JSON.stringify({ version }), 'blob.json'),
      ).toThrow(/must match both the Rstest version and reporter format/);
    }
  });
});

describe('blob cancellation', () => {
  it.for([false, true])(
    'invalidates only its shard (already written: %s)',
    async (alreadyWritten, { onTestFinished }) => {
      const rootPath = mkdtempSync(join(tmpdir(), 'rstest-blob-cancel-'));
      onTestFinished(() => rmSync(rootPath, { recursive: true, force: true }));
      const reporter = new BlobReporter({
        rootPath,
        config: { ...withDefaultConfig({}), shard: { index: 1, count: 2 } },
      });
      const sibling = new BlobReporter({
        rootPath,
        config: { ...withDefaultConfig({}), shard: { index: 2, count: 2 } },
      });
      const result = {
        ...emptyRunEndPayload,
      };
      await sibling.onTestRunEnd(result);
      if (alreadyWritten) await reporter.onTestRunEnd(result);
      const path = join(rootPath, '.rstest-reports', 'blob-1-2.json');
      expect(existsSync(path)).toBe(alreadyWritten);
      reporter.cancel();
      await reporter.onTestRunEnd(result);
      expect(existsSync(path)).toBe(false);
      expect(
        existsSync(join(rootPath, '.rstest-reports', 'blob-2-2.json')),
      ).toBe(true);
    },
  );
});
