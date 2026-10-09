import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('cleanup functions run in the correct order and hooks do not run in a fully skipped file', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'cleanup.test', 'skip.test'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(cli.stdout, 'cleanup fixture passes').toMatch(
    /✓ fixtures\/cleanup\.test\.ts/,
  );
  // Every hook in skip.test logs 'should not run', so key on that text:
  // cleanup.test also logs '[beforeAll]' and '[afterAll]' lines.
  expect(
    logs.filter(
      (log) =>
        (log.startsWith('[before') || log.startsWith('[after')) &&
        !log.includes('should not run'),
    ),
    'cleanup functions run in the correct order',
  ).toEqual([
    '[beforeEach] cleanup root',
    '[beforeEach] cleanup in level A',

    '[beforeEach] cleanup root',
    '[beforeEach] cleanup in level A',
    '[beforeAll] cleanup in level B-A',

    '[beforeEach] cleanup root',
    '[beforeEach] cleanup in level A',
    '[beforeAll] cleanup in level B-B',

    '[beforeAll] cleanup in level A',

    '[afterAll] root',
    '[beforeAll] cleanup root',
    '[beforeAll] cleanup root1',
  ]);

  expect(
    cli.stdout,
    'skip.test (all cases skipped/todo) is collected and passes',
  ).toMatch(/✓ fixtures\/skip\.test\.ts/);
  expect(
    logs.find((log) => log.includes('[beforeAll] should not run')),
    'beforeAll hooks do not run when every case in the file is skipped/todo',
  ).toBeFalsy();
  expect(
    logs.find((log) => log.includes('[afterAll] should not run')),
    'afterAll hooks do not run when every case in the file is skipped/todo',
  ).toBeFalsy();
  expect(
    logs.find((log) => log.includes('should not run')),
    'no beforeAll/afterAll/beforeEach/afterEach hook in skip.test runs when no test case executes',
  ).toBeFalsy();
});
