import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should match the same snapshots when a test is retried or repeated', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/retry.test.ts'],
    options: {
      nodeOptions: {
        cwd: __dirname,
        // do not write new snapshots, so a wrong snapshot key fails the test
        env: { CI: 'true' },
      },
    },
  });

  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.find((log) => log.includes('Tests 2 passed'))).toBeTruthy();
  expect(logs.find((log) => log.includes('Snapshots'))).toBeFalsy();
});
