import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('Describe Each API', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/each.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.find((log) => log.includes('Tests 6 passed'))).toBeTruthy();
});
