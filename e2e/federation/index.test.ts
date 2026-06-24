import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('federation', () => {
  it('should install federation runtime shims when enabled in config', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should keep federation runtime shims when isolate is disabled', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--isolate', 'false'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should not install federation runtime shims by default', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/disabled'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should enable federation mode via the --federation CLI flag', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--federation'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/cli'),
        },
      },
    });

    await expectExecSuccess();
  });
});
