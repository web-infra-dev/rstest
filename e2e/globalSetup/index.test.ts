import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('globalSetup', async () => {
  it('should run global setup file correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter((log) => log.includes('['));

    expect(logs).toMatchInlineSnapshot(`
      [
        "[global-setup-default] executed",
        "[global-setup-named] executed",
        "[rstest] Running basic tests",
        "[rstest] Running basic tests",
        "[global-teardown-named] executed",
        "[global-teardown-default] executed",
      ]
    `);
  });

  it('should fail when global setup throws an error', async () => {
    const { expectStderrLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/error'),
        },
      },
    });

    await expectExecFailed();

    // Check for global setup error message
    expectStderrLog(/Global setup failed intentionally/);
    expectStderrLog(/globalSetup\.ts:2:8/);
  });
});
