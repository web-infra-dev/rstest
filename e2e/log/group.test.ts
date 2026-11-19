import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('console group', () => {
  it('should indent grouped output as Node does', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'group.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(
      cli.stdout.split('\n').filter((line) => line.includes('[group]')),
    ).toEqual([
      '[group] A',
      '  [group] inside',
      '  [group] line 1',
      '  [group] line 2',
      '  [group] B',
      '    [group] nested 1',
      '    [group] nested 2',
      '[group] outside',
    ]);
  });
});
