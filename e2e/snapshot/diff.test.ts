import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should show diff as expected', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/diff.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stderr.split('\n').filter(Boolean);

  expect(logs.length).toBeLessThan(100);
  expect(logs.find((log) => log.includes('-     99"'))).toBeTruthy();
  expect(logs.find((log) => log.includes('+     100"'))).toBeTruthy();
});
