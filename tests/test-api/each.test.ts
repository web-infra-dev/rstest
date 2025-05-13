import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { getTestName, runRstestCli } from '../scripts';

it('Test Each API', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/each.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(
    logs
      .filter((log) => log.includes('add'))
      .map((log) => getTestName(log, '✓')),
  ).toMatchInlineSnapshot(`
    [
      "add(1, 1) -> 2",
      "add(1, 2) -> 3",
      "add(2, 1) -> 3",
      "case-0 add(2, 1) -> 3",
      "case-1 add(2, 2) -> 4",
      "case-2 add(3, 1) -> 4",
    ]
  `);

  expect(logs.find((log) => log.includes('Tests 6 passed'))).toBeTruthy();
});

it('Test For API', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/for.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(
    logs
      .filter((log) => log.includes('add'))
      .map((log) => getTestName(log, '✓')),
  ).toMatchInlineSnapshot(`
    [
      "add(1, 1) -> 2",
      "add(1, 2) -> 3",
      "add(2, 1) -> 3",
      "case-0 add(2, 1) -> 3",
      "case-1 add(2, 2) -> 4",
      "case-2 add(3, 1) -> 4",
    ]
  `);

  expect(logs.find((log) => log.includes('Tests 6 passed'))).toBeTruthy();
});
