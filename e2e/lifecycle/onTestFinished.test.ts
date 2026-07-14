import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('onTestFinished', () => {
  it('should run fixture teardown before user callbacks', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.fixture.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(
      cli.stdout.split('\n').filter((line) => line.startsWith('[')),
    ).toEqual(['[fixture] teardown', '[onTestFinished] cleanup']);
  });

  it('onTestFinished should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[afterEach] in level A",
        "[afterEach] root",
        "[onTestFinished] in level A",
        "[afterEach] root",
      ]
    `);
  });

  it('should run test failed when onTestFinished error', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.failed.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    expectStderrLog('onTestFinished failed');
  });

  it('should run onTestFinished failed when onTestFinished outside', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.outside.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    expectStderrLog('onTestFinished() can only be called inside a test');
  });
});
