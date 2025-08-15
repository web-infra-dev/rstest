import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('github-actions', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'githubActions', '--reporter', 'github-actions'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stdout
    .split('\n')
    .filter(Boolean)
    .filter((log) => log.startsWith('::error'));

  expect(logs).toMatchInlineSnapshot(`
    [
      "::error file=<ROOT>/tests/reporter/fixtures/githubActions.test.ts,line=4,col=17,title=fixtures/githubActions.test.ts > should add two numbers correctly::expected 2 to be 4 // Object.is equality%0A- Expected%0A+ Received%0A%0A- 4%0A+ 2",
      "::error file=<ROOT>/tests/reporter/fixtures/githubActions.test.ts,line=8,col=19,title=fixtures/githubActions.test.ts > test snapshot::Snapshot \`test snapshot 1\` mismatched%0A- Expected%0A+ Received%0A%0A- "hello world"%0A+ "hello"",
    ]
  `);
});
