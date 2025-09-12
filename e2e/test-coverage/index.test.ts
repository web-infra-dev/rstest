import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

it('coverage-istanbul', async () => {
  const { expectExecSuccess, expectLog, cli } = await runRstestCli({
    command: 'rstest',
    args: ['run'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('Coverage enabled with istanbul', logs);

  // test coverage
  expect(
    logs.find(
      (log) =>
        log.includes('index.test.ts') &&
        log.replaceAll(' ', '').includes('100|100|100|100'),
    ),
  ).toBeFalsy();

  expect(
    logs.find(
      (log) =>
        log.includes('rstest.setup.ts') &&
        log.replaceAll(' ', '').includes('100|100|100|100'),
    ),
  ).toBeFalsy();

  expect(
    logs.find(
      (log) =>
        log.includes('index.ts') &&
        log.replaceAll(' ', '').includes('100|100|100|100'),
    ),
  ).toBeTruthy();
  expect(
    logs.find((log) => log.includes('string.ts'))?.replaceAll(' ', ''),
  ).toMatchInlineSnapshot(`"string.ts|93.75|100|83.33|92.85|7"`);

  expect(
    logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
  ).toMatchInlineSnapshot(`"Allfiles|98.33|100|94.44|98.21|"`);

  // text reporter
  expectLog('% Stmts', logs);

  // html reporter
  expect(
    fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
  ).toBeTruthy();

  // clover reporter
  expect(
    fs.existsSync(join(__dirname, 'fixtures/coverage/clover.xml')),
  ).toBeTruthy();

  // json reporter
  expect(
    fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
  ).toBeTruthy();
});

it('coverage-istanbul with custom options', async () => {
  const { expectExecSuccess, expectLog, cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', '-c', 'rstest.skipFull.config.ts'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('Coverage enabled with istanbul', logs);

  // test coverage
  expect(logs.find((log) => log.includes('index.ts'))).toBeFalsy();
  expect(
    logs.find((log) => log.includes('string.ts'))?.replaceAll(' ', ''),
  ).toMatchInlineSnapshot(`"string.ts|93.75|100|83.33|92.85|7"`);

  // text reporter
  expectLog('% Stmts', logs);

  expect(
    fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
  ).toBeFalsy();
});

it('coverage-istanbul with custom reportsDirectory', async () => {
  const { expectExecSuccess, expectLog, cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', '-c', 'rstest.reportsDirectory.config.ts'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('Coverage enabled with istanbul', logs);

  expect(
    fs.existsSync(join(__dirname, 'fixtures/test-temp-coverage/index.html')),
  ).toBeTruthy();
});
