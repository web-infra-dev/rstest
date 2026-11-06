import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('node pool e2e', () => {
  it.for(['forks', 'threads', 'vmThreads', 'vmForks'] as const)(
    'should run tests under the %s pool',
    async (pool, { onTestFinished }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool',
          pool,
          '--isolate',
          'true',
          ...(pool === 'vmThreads' || pool === 'vmForks'
            ? ['--pool.memoryLimit', '256MB']
            : []),
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, './fixtures'),
            env: {
              ISOLATE: undefined,
              NODE_OPTIONS:
                pool === 'forks' || pool === 'threads'
                  ? `--import=${pathToFileURL(join(__dirname, './fixtures/nativePoolGuard.mjs')).href}`
                  : undefined,
              RSTEST_EXPECT_FORKS:
                pool === 'forks' || pool === 'vmForks' ? '1' : undefined,
            },
          },
        },
      });

      await expectExecSuccess();
    },
  );

  it('should support the complete importActual path under vmThreads', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        './mock/tests/importActual.test.ts',
        '--pool',
        'vmThreads',
        '--pool.memoryLimit',
        '256MB',
        '--isolate',
        'true',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, '..'),
          env: { ISOLATE: undefined },
        },
      },
    });

    await expectExecSuccess();
  });

  it.for(
    (['vmForks', 'vmThreads'] as const).flatMap((pool) =>
      [false, true].flatMap((isolate) =>
        [false, true].map((cleanupFailure) => ({
          pool,
          isolate,
          cleanupFailure,
        })),
      ),
    ),
  )(
    'keeps VM files isolated: %j',
    async ({ pool, isolate, cleanupFailure }, { onTestFinished }) => {
      const markerDirectory = mkdtempSync(join(tmpdir(), 'rstest-vm-cleanup-'));
      const cleanupMarker = join(markerDirectory, 'worker-fixture-cleanup.txt');
      const guardMarker = join(markerDirectory, 'process-guard.txt');
      const waitMarker = join(markerDirectory, 'wait-reactions.txt');
      const fileCleanupMarker = join(markerDirectory, 'file-cleanup.txt');
      writeFileSync(fileCleanupMarker, '');
      writeFileSync(waitMarker, '');
      onTestFinished(() =>
        rmSync(markerDirectory, { force: true, recursive: true }),
      );
      const { cli, expectExecSuccess, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool',
          pool,
          '--pool.maxWorkers',
          '1',
          '--pool.memoryLimit',
          '256MB',
          '--isolate',
          String(isolate),
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, './fixtures/vm-isolate-false'),
            env: {
              RSTEST_VM_CLEANUP_MARKER: cleanupMarker,
              RSTEST_VM_GUARD_MARKER: guardMarker,
              RSTEST_VM_WAIT_MARKER: waitMarker,
              RSTEST_VM_FILE_CLEANUP_MARKER: fileCleanupMarker,
              RSTEST_VM_FILE_CLEANUP_FAIL: String(cleanupFailure),
            },
          },
        },
      });

      if (cleanupFailure) {
        await expectExecFailed();
        expect(`${cli.stdout}\n${cli.stderr}`).toContain(
          'VM_FILE_CLEANUP_FAILURE',
        );
      } else {
        await expectExecSuccess();
      }
      expect(readFileSync(fileCleanupMarker, 'utf8')).toBe(
        'cleaned\ncleaned\n',
      );

      const output = `${cli.stdout}\n${cli.stderr}`;
      expect(output.match(/VM_SETUP_FILE/g)).toHaveLength(2);
      expect(output.match(/VM_OBJECT_URL_REVOKED/g)).toHaveLength(1);
      expect(output.match(/VM_PROMISIFIED_TIMERS_CANCELLED/g)).toHaveLength(1);
      expect(output.match(/VM_WORKER_FIXTURE_SETUP/g)).toHaveLength(2);
      expect(
        readFileSync(cleanupMarker, 'utf8').trim().split('\n'),
      ).toHaveLength(2);
      expect(readFileSync(guardMarker, 'utf8').trim()).toBe('guarded');
      expect(readFileSync(waitMarker, 'utf8')).toBe('');

      const threadIds = [...output.matchAll(/VM_THREAD_ID:(\d+)/g)].map(
        (match) => match[1],
      );
      expect(threadIds).toHaveLength(2);
      expect(new Set(threadIds).size).toBe(1);
      const processIds = [...output.matchAll(/VM_PROCESS_ID:(\d+)/g)].map(
        (match) => match[1],
      );
      expect(processIds).toHaveLength(2);
      expect(new Set(processIds).size).toBe(1);
    },
  );

  it('rejects non-cloneable environment options before worker dispatch', async ({
    onTestFinished,
  }) => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures/non-cloneable-options'),
        },
      },
    });

    await expectExecFailed();
    expectStderrLog(
      'Node worker pools require `testEnvironment.options` to be structured-cloneable',
    );
  });
});
