import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('afterAll', () => {
  it('afterAll should be invoked in the correct order', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    const logs = process.stdout
      .split('\n')
      .filter((log) => log.startsWith('[afterAll]'));

    expect(logs).toEqual([
      '[afterAll] in level B-A',
      '[afterAll] in level B-B',
      '[afterAll] in level A',
      '[afterAll] root',
    ]);
  });
});
