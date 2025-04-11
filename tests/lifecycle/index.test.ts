import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('afterAll', () => {
  it('afterAll should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'afterAll'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('[afterAll]'))).toEqual([
      '[afterAll] in level B-A',
      '[afterAll] in level B-B',
      '[afterAll] in level A',
      '[afterAll] root',
    ]);

    // test log print
    expect(
      logs.find((log) => log.includes('✓ level A > it in level A')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('_internal_root_suite')),
    ).toBeFalsy();
  });
});

describe('beforeAll', () => {
  it('beforeAll should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'beforeAll'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('[beforeAll]'))).toEqual([
      '[beforeAll] root',
      '[beforeAll] in level A',
      '[beforeAll] in level B-A',
      '[beforeAll] in level B-B',
    ]);
  });
});
