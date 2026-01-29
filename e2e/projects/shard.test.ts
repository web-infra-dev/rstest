import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects sharding', () => {
  it('should run the first shard of 2', async () => {
    const { cli, expectExecSuccess, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--shard', '1/2', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // Check log message
    expectLog('Running shard 1 of 2 (3 of 6 tests)', logs);

    // Check that only files from the first shard are run
    expectLog('packages/client/test/App.test.tsx', logs);
    expectLog('packages/client/test/index.test.ts', logs);
    expectLog('packages/client-vue/test/index.test.ts', logs);

    // Check that files from the second shard are NOT run
    expect(
      logs.some((log) => log.includes('packages/client/test/node.test.ts')),
    ).toBeFalsy();
    expect(
      logs.some((log) => log.includes('packages/node/test/index.test.ts')),
    ).toBeFalsy();
    expect(
      logs.some((log) => log.includes('packages/node/test/mockFs.test.ts')),
    ).toBeFalsy();
  }, 30000);

  it('should run the second shard of 2', async () => {
    const { cli, expectExecSuccess, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--shard', '2/2', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // Check log message
    expectLog('Running shard 2 of 2 (3 of 6 tests)', logs);

    // Check that files from the first shard are NOT run
    expect(
      logs.some((log) => log.includes('packages/client/test/App.test.tsx')),
    ).toBeFalsy();
    expect(
      logs.some((log) => log.includes('packages/client/test/index.test.ts')),
    ).toBeFalsy();
    expect(
      logs.some((log) =>
        log.includes('packages/client-vue/test/index.test.ts'),
      ),
    ).toBeFalsy();

    // Check that only files from the second shard are run
    expectLog('packages/client/test/node.test.ts', logs);
    expectLog('packages/node/test/index.test.ts', logs);
    expectLog('packages/node/test/mockFs.test.ts', logs);
  }, 30000);

  it('should run failed on an empty shard', async () => {
    const { expectExecFailed, expectLog, expectStderrLog } = await runRstestCli(
      {
        command: 'rstest',
        args: ['run', '--shard', '7/7', '--globals'], // Total 6 tests, so 7th shard is empty
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      },
    );

    await expectExecFailed();

    // Check log message
    expectLog('Running shard 7 of 7 (0 of 6 tests)');
    expectStderrLog('No test files found, exiting with code 1.');
  });
});
