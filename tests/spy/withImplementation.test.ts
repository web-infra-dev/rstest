import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('test withImplementation', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/withImplementation.test'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);
  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
    [
      "[call callback]",
      "[call temp]",
      "[call temp]",
      "[callback res] temp temp",
      "[call myMockFn]",
      "[call original - 1]",
      "[call myMockFn - 1]",
      "[call original]",
      "[1 - call callback]",
      "[1 - call temp]",
      "[1 - callback res] temp",
      "[1 - call myMockFn]",
      "[1 - call original]",
      "[1 - call myMockFn - 1]",
      "[1 - call original]",
    ]
  `);
});
