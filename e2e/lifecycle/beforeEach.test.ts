import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('beforeEach', () => {
  it('beforeEach should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'beforeEach.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('[beforeEach]'))).toEqual([
      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',

      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',
      '[beforeEach] in level B-A',

      '[beforeEach] root',
      '[beforeEach] root async',
      '[beforeEach] in level A',
      '[beforeEach] in level B-B',
    ]);
  });
});
