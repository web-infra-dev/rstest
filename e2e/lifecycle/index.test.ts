import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('cleanup functions should run in reverse setup order by default', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'cleanup.test'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();
  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(
    logs.filter((log) => log.startsWith('[before') || log.startsWith('[after')),
  ).toEqual([
    '[beforeEach] cleanup in level A',
    '[beforeEach] cleanup root',

    '[beforeEach] cleanup in level A',
    '[beforeEach] cleanup root',
    '[beforeAll] cleanup in level B-A',

    '[beforeEach] cleanup in level A',
    '[beforeEach] cleanup root',
    '[beforeAll] cleanup in level B-B',

    '[beforeAll] cleanup in level A',

    '[afterAll] root',
    '[beforeAll] cleanup root1',
    '[beforeAll] cleanup root',
  ]);
});

describe('skipped', () => {
  it('should not run hooks when no test case execution', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'skip.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.find((log) => log.includes('[afterAll]'))).toBeFalsy();
    expect(logs.find((log) => log.includes('[beforeAll]'))).toBeFalsy();
  });
});
