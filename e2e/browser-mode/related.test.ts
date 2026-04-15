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
});
