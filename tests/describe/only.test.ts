import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('test only', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/only.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
    [
      "[beforeEach] root",
      "[test] in level B-A",
      "[beforeEach] root",
      "[test] in level B-C-A",
      "[beforeEach] root",
      "[test] in level E-A",
    ]
  `);

  expect(logs.find((log) => log.includes('Test Files 1 passed'))).toBeTruthy();
  expect(
    logs.find((log) => log.includes('Tests 3 passed | 4 skipped')),
  ).toBeTruthy();
});
