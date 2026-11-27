import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
              RSTEST_EXPECT_VM:
                pool === 'vmThreads' || pool === 'vmForks' ? '1' : undefined,
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

  it.for(['forks', 'vmThreads', 'vmForks'] as const)(
    'runs file and worker cleanups registered by an externalized node_modules package under %s',
    async (pool, { onTestFinished }) => {
      const fixtureDir = mkdtempSync(
        join(tmpdir(), 'rstest-external-cleanup-'),
      );
      const markerFile = join(fixtureDir, 'cleanup-events.txt');
      writeFileSync(markerFile, '');
      onTestFinished(() =>
        rmSync(fixtureDir, { force: true, recursive: true }),
      );

      const pluginDir = join(
        fixtureDir,
        'node_modules',
        'external-cleanup-plugin',
      );
      mkdirSync(pluginDir, { recursive: true });
      mkdirSync(join(fixtureDir, 'node_modules', '@rstest'), {
        recursive: true,
      });
      symlinkSync(
        join(__dirname, '../../packages/core'),
        join(fixtureDir, 'node_modules', '@rstest', 'core'),
        'junction',
      );

      writeFileSync(
        join(pluginDir, 'package.json'),
        JSON.stringify({
          name: 'external-cleanup-plugin',
          type: 'module',
          exports: { '.': './index.mjs' },
        }),
      );
      writeFileSync(
        join(pluginDir, 'index.mjs'),
        [
          "import { appendFileSync } from 'node:fs';",
          "import { registerFileCleanup, registerWorkerCleanup } from '@rstest/core/internal/node-runtime';",
          'export function registerExternalCleanups(markerPath) {',
          '  registerFileCleanup(() => {',
          "    appendFileSync(markerPath, 'file\\n');",
          '  });',
          '  registerWorkerCleanup(() => {',
          "    appendFileSync(markerPath, 'worker\\n');",
          '  });',
          '}',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(fixtureDir, 'rstest.config.mjs'),
        [
          'export default {',
          "  include: ['./index.test.ts'],",
          "  testEnvironment: 'node',",
          '};',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(fixtureDir, 'index.test.ts'),
        [
          "import * as core from '@rstest/core';",
          "import { registerExternalCleanups } from 'external-cleanup-plugin';",
          '',
          "core.test('registers cleanups from externalized package', () => {",
          "  core.expect('registerFileCleanup' in core).toBe(false);",
          "  core.expect('registerWorkerCleanup' in core).toBe(false);",
          '  registerExternalCleanups(process.env.RSTEST_EXTERNAL_CLEANUP_MARKER!);',
          '});',
          '',
        ].join('\n'),
      );

      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--pool', pool, '--pool.maxWorkers', '1'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixtureDir,
            env: {
              ISOLATE: undefined,
              RSTEST_EXTERNAL_CLEANUP_MARKER: markerFile,
            },
          },
        },
      });

      await expectExecSuccess();
      const events = readFileSync(markerFile, 'utf8').trim().split('\n').sort();
      expect(events).toEqual(['file', 'worker']);
    },
  );
});
