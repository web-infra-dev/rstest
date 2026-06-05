import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - related', () => {
  it('should filter browser tests by related source files', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--related', 'tests/src/index.ts', '--filesOnly'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'related'),
          env: {
            CI: '',
            GITHUB_ACTIONS: '',
          },
        },
      },
    });

    await expectExecSuccess();

    expect(
      cli.stdout.split('\n').filter((line) => line.includes('.test.ts')),
    ).toEqual(['tests/index.test.ts']);
  });

  it('should not run the full browser suite when related finds no tests', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--related', 'tests/src/missing.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'related'),
          env: {
            CI: '',
            GITHUB_ACTIONS: '',
          },
        },
      },
    });

    await expectExecFailed();

    expect(cli.stderr).toContain(
      'No test files found for related source files, exiting with code 1.',
    );
    expect(cli.log).toContain('related:');
    expect(cli.log).toContain('tests/src/missing.ts');
    expect(cli.log).not.toContain('index.test.ts');
    expect(cli.log).not.toContain('other.test.ts');
  });
});
