import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('afterEach', () => {
  it('afterEach should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'afterEach.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('[afterEach]'))).toEqual([
      '[afterEach] in level A',
      '[afterEach] root',

      '[afterEach] in level B-A',
      '[afterEach] in level A',
      '[afterEach] root',

      '[afterEach] in level B-B',
      '[afterEach] in level A',
      '[afterEach] root',
    ]);
  });
});
