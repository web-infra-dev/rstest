import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Rspack adapter', () => {
  it('should apply Rspack compiler options to test modules', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('applies Rspack externals');
    expect(cli.stdout).toContain('applies Rspack-only resolve options');
    expect(cli.stdout).toContain('applies resolve.tsConfig references');
    expect(cli.stdout).toContain('Test Files 1 passed');
  });
});
