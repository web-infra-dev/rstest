import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test config load', () => {
  it('should throw error when custom test config not found', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'a.config.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/Cannot find config file/);
  });

  it('should throw error when plugin setup error', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'fixtures/plugin.error.config.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/plugin setup error/);
  });

  it('should throw error when plugin setup error in watch mode', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: [
        'watch',
        'success.test.ts',
        '-c',
        'fixtures/plugin.error.config.ts',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/plugin setup error/);
  });

  it('should print error correctly when worker unexpectedly error', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['success.test.ts', '-c', 'fixtures/worker.error.config.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/bad option: --invalid-flag/);
  });
});
