import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('teamcity', async () => {
  const { cli, expectLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'teamcity', '--reporter', 'teamcity'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog(
    "##teamcity[testSuiteStarted flowId='fixtures/teamcity.test.ts' name='fixtures/teamcity.test.ts']",
    logs,
  );
  expectLog(
    "##teamcity[testStarted flowId='fixtures/teamcity.test.ts' name='Teamcity test > should pass']",
    logs,
  );
  expectLog(
    /##teamcity\[testFailed .*name='Teamcity test > should fail'.*type='comparisonFailure'/,
    logs,
  );
  expectLog(
    "##teamcity[testIgnored flowId='fixtures/teamcity.test.ts' name='Teamcity test > should skip']",
    logs,
  );
  expectLog(
    "##teamcity[testSuiteFinished flowId='fixtures/teamcity.test.ts' name='fixtures/teamcity.test.ts']",
    logs,
  );
});
