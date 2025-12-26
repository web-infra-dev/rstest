import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('beforeAll', () => {
  it('beforeAll should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'beforeAll.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('[beforeAll]'))).toEqual([
      '[beforeAll] root',
      '[beforeAll] root async',
      '[beforeAll] in level A',
      '[beforeAll] in level B-A',
      '[beforeAll] in level B-B',
    ]);
  });
});
