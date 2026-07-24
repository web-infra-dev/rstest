import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('reports hook fixtures missing from tests in the suite', async () => {
  const { cli, expectExecFailed, expectStderrLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/hookFixtureMismatch.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecFailed();
  expectStderrLog(/Hook has unknown fixture "extendedValue"/);
  expectStderrLog(/Hook has unknown fixture "firstValue"/);
  expectStderrLog(/Hook has unknown fixture "cleanupValue"/);
  expect(`${cli.stdout}\n${cli.stderr}`).not.toContain('received a missing');
});
