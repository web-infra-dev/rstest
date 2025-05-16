import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('should run concurrent cases correctly with limit', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/concurrentLimit.test.ts', '--maxConcurrency=4'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.filter((log) => log.includes('[log]'))).toMatchInlineSnapshot(`
      [
        "[log] concurrent test 1",
        "[log] concurrent test 2",
        "[log] concurrent test 3",
        "[log] concurrent test 4",
        "[log] concurrent test 2 - 1",
        "[log] concurrent test 5",
        "[log] concurrent test 3 - 1",
        "[log] concurrent test 6",
        "[log] concurrent test 4 - 1",
        "[log] concurrent test 7",
        "[log] concurrent test 1 - 1",
        "[log] concurrent test 5 - 1",
        "[log] concurrent test 6 - 1",
        "[log] concurrent test 7 - 1",
      ]
    `);
});
