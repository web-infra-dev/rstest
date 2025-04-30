import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test Condition', () => {
  it('Support runIf & skipIf', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/condition.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);
    expect(
      logs.find((log) => log.includes('Tests 1 passed | 3 skipped')),
    ).toBeTruthy();
  });
});
