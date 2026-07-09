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
          // This test spawns nested `rstest` runs. In the e2e `test:no-isolate`
          // step we set `ISOLATE=false`, which would be inherited by the child
          // process and make the nested run non-isolated as well (flaky on CI).
          env: { ISOLATE: undefined },
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
    const { expectStderrLog, expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/error'),
        },
      },
    });

    await expectExecFailed();

    expect(cli.log).not.toContain('This should not be printed');

    // Check for global setup error message
    expectStderrLog(/Global setup failed intentionally/);
    expectStderrLog(/globalSetup\.ts:2/);
  });

  it('should fail when global teardown throws an error', async () => {
    const { expectStderrLog, expectLog, expectExecFailed } = await runRstestCli(
      {
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            env: { ISOLATE: undefined },
            cwd: join(__dirname, 'fixtures/teardown-error'),
          },
        },
      },
    );

    await expectExecFailed();

    expectLog(/This should be printed/);

    // Check for global setup error message
    expectStderrLog(/Global teardown failed intentionally/);
    expectStderrLog(/globalSetup\.ts:3/);
  });
});
