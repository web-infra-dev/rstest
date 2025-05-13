import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('Describe only.each API', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/only.each.test.ts'],
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
    logs.find((log) => log.includes('Tests 3 passed | 2 skipped')),
  ).toBeTruthy();
});

it('Describe skip.each API', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/skip.each.test.ts'],
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
    logs.find((log) => log.includes('Tests 2 passed | 3 skipped')),
  ).toBeTruthy();
});

it('Describe chain API enumerable', async () => {
  expect(Object.keys(describe)).toMatchInlineSnapshot(`
    [
      "only",
      "todo",
      "skip",
      "concurrent",
      "skipIf",
      "runIf",
      "each",
    ]
  `);
  expect(Object.keys(describe.only)).toMatchInlineSnapshot(`
    [
      "only",
      "todo",
      "skip",
      "concurrent",
      "skipIf",
      "runIf",
      "each",
    ]
  `);
});
