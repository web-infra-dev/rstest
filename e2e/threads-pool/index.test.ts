import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('threads pool e2e', () => {
  for (const pool of ['threads', 'vmThreads'] as const) {
    it(`should run tests under the ${pool} pool`, async ({
      onTestFinished,
    }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool',
          pool,
          '--isolate',
          'true',
          ...(pool === 'vmThreads' ? ['--pool.memoryLimit', '256MB'] : []),
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, './fixtures'),
            env: { ISOLATE: undefined },
          },
        },
      });

      await expectExecSuccess();
    });
  }

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

  it('keeps vmThreads file-isolated when isolate is false', async ({
    onTestFinished,
  }) => {
    const markerDirectory = mkdtempSync(join(tmpdir(), 'rstest-vm-cleanup-'));
    const cleanupMarker = join(markerDirectory, 'worker-fixture-cleanup.txt');
    onTestFinished(() =>
      rmSync(markerDirectory, { force: true, recursive: true }),
    );
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--pool',
        'vmThreads',
        '--pool.maxWorkers',
        '1',
        '--pool.memoryLimit',
        '256MB',
        '--isolate=false',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures/vm-isolate-false'),
          env: { RSTEST_VM_CLEANUP_MARKER: cleanupMarker },
        },
      },
    });

    await expectExecSuccess();

    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output.match(/VM_SETUP_FILE/g)).toHaveLength(2);
    expect(output.match(/VM_WORKER_FIXTURE_SETUP/g)).toHaveLength(2);
    expect(readFileSync(cleanupMarker, 'utf8').trim().split('\n')).toHaveLength(
      2,
    );

    const threadIds = [...output.matchAll(/VM_THREAD_ID:(\d+)/g)].map(
      (match) => match[1],
    );
    expect(threadIds).toHaveLength(2);
    expect(new Set(threadIds).size).toBe(1);
  });
});
