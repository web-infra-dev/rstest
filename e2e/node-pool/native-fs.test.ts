import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/vm-native-fs',
);

it.for(
  (['vmForks', 'vmThreads'] as const).flatMap((pool) =>
    ['node', 'jsdom', 'happy-dom'].flatMap((environment) =>
      [true, false].flatMap((isolate) =>
        (['none', 'test', 'cleanup'] as const).map((failure) => ({
          pool,
          environment,
          isolate,
          failure,
        })),
      ),
    ),
  ),
)(
  'reuses native fs and restores VM file spies: %j',
  async (options, { onTestFinished }) => {
    const { pool, environment, isolate, failure } = options;
    const { cli, expectExecSuccess, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--pool',
        pool,
        '--testEnvironment',
        environment,
        '--isolate',
        String(isolate),
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: fixture,
          env: { RSTEST_VM_FAILURE: failure },
        },
      },
    });
    if (failure !== 'none') {
      await expectExecFailed();
      expect(`${cli.stdout}\n${cli.stderr}`).toContain(
        failure === 'cleanup'
          ? 'VM_NATIVE_FS_EXPECTED_CLEANUP_FAILURE'
          : 'VM_NATIVE_FS_EXPECTED_TEST_FAILURE',
      );
    } else {
      await expectExecSuccess();
    }
    const output = `${cli.stdout}\n${cli.stderr}`;
    // Intentional failures must not hide unrelated assertion failures.
    expect(output).toMatch(
      failure === 'test'
        ? /Tests\s+1 failed \| 8 passed \(9\)/
        : /Tests\s+8 passed/,
    );
    expect(output.match(/VM_NATIVE_FS_GRACEFUL_INSTALLED/g)).toHaveLength(1);
    expect(output.match(/VM_NATIVE_FS_REUSED_AND_CLEAN/g)).toHaveLength(1);
    expect(output.match(/VM_NATIVE_FS_SPIES_RESTORED/g)).toHaveLength(1);
    expect(output.match(/VM_NATIVE_FS_CAPTURED_SPIES_RESET/g)).toHaveLength(1);
    for (const marker of [
      'VM_NATIVE_FS_RETRY_QUEUE_DRAINED',
      'VM_FILE_MOCKS_RESET_AND_RESTORED',
    ]) {
      expect(output.match(new RegExp(marker, 'g'))).toHaveLength(1);
    }
    expect(output).not.toContain('clearTimeout is not defined');
    expect(output).not.toContain('expected true to be false');
  },
);
