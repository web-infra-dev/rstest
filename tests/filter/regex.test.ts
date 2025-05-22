import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should filter test suite name success use regex', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/testNamePattern.test.ts',
      '-c=fixtures/testNamePattern.config.ts',
    ],
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
      "[test] in level-B-A",
      "[test] in level-B-C-A",
    ]
  `);
});
