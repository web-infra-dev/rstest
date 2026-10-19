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
        "[afterEach] root",
        "[onTestFinished] outer",
      ]
    `);
  });

  it('fails the test when onTestFinished throws and the file when it is called outside a test', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'onTestFinished.failed.test',
        'onTestFinished.outside.test',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    expect(cli.stdout, 'a throwing onTestFinished fails its test').toMatch(
      /✗ fixtures\/onTestFinished\.failed\.test\.ts/,
    );
    expect(
      cli.stderr,
      'onTestFinished error is reported for the test that registered it',
    ).toMatch(
      /FAIL\s+fixtures\/onTestFinished\.failed\.test\.ts > level A > it in level A\nError: onTestFinished failed/,
    );
    expect(
      cli.stdout,
      'calling onTestFinished outside a test fails the file',
    ).toMatch(/✗ fixtures\/onTestFinished\.outside\.test\.ts/);
    expect(
      cli.stderr,
      'onTestFinished outside a test reports a usage error for that file',
    ).toMatch(
      /FAIL\s+fixtures\/onTestFinished\.outside\.test\.ts\s*\nError: onTestFinished\(\) can only be called inside a test/,
    );
  });
});
