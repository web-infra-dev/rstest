import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should run success without filter', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/testNamePattern.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
    [
      "[test] in level-B-A",
      "[test] in level-B-C-A",
      "[test] in level-C",
      "[test] in level-D-A",
    ]
  `);
});
