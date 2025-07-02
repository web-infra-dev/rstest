import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('jsdom', () => {
  it('should catch error correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'test/unhandledError'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
  });
});

describe('happy-dom', () => {
  it('should catch error correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--testEnvironment=happy-dom', 'test/unhandledError'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
  });
});
