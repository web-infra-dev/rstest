import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('includes hook fixture setup in the hook timeout', async () => {
  const { cli, expectLog, expectStderrLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/hookFixtureTimeout.test', '--hookTimeout=20'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;

  expect(cli.exec.process?.exitCode).toBe(1);
  expectStderrLog(/Error: beforeEach hook timed out in 20ms/);
  expectStderrLog(/Error: afterEach hook timed out in 20ms/);
  expectStderrLog(/Error: beforeEach hook timed out in 30ms/);
  expectStderrLog(/Error: late fixture teardown failed/);
  expectLog(/Tests 4 failed \| 1 passed/);
});
