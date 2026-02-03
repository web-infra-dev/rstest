import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test environment variables', () => {
  it('should get environment variables correctly in test', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should pass FORCE_COLOR to worker process when user sets it', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'forceColor.test.ts'],
      onTestFinished,
      // Explicitly unset NO_COLOR to avoid conflicts
      unsetEnv: ['NO_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            // User explicitly sets FORCE_COLOR=1
            FORCE_COLOR: '1',
          },
        },
      },
    });

    await expectExecSuccess();
  });

  it('should set FORCE_COLOR=0 when NO_COLOR is set to prevent conflicts', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'noColor.test.ts'],
      onTestFinished,
      // Explicitly unset FORCE_COLOR to let the default logic handle it
      unsetEnv: ['FORCE_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            // User sets NO_COLOR=1 to disable colors
            NO_COLOR: '1',
          },
        },
      },
    });

    await expectExecSuccess();
  });
});
