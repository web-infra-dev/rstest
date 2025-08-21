import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('onTestFinished', () => {
  it('onTestFinished should be invoked in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
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
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.failed.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    expectLog('onTestFinished failed');
  });

  it('should run onTestFinished failed when onTestFinished outside', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFinished.outside.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    expectLog('onTestFinished() can only be called inside a test');
  });
});
