import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - no tests', () => {
  it('should exit with code 1 by default when no tests found', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'no-tests'),
        },
      },
    });

    await expectExecFailed();
    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
  });

  it('should exit with code 0 when passWithNoTests flag is enabled', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--passWithNoTests'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'no-tests'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('No test files found, exiting with code 0.');
  });
});
