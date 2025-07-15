import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);
it('should catch `Worker exited unexpectedly` error correctly', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'processKill.test.ts', '--disableConsoleIntercept'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });
  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(
    logs.find((log) => log.includes('Worker exited unexpectedly')),
  ).toBeDefined();

  expect(logs.find((log) => log.includes('Test Files 1 failed'))).toBeDefined();
});
