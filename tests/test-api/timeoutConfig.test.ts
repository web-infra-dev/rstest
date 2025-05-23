import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test timeout configuration', () => {
  it('should not throw timeout error when update timeout time via testTimeout configuration', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/timeout.test', '--testTimeout=10000'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    // The timeout set by the API is higher than the global configuration item
    expect(
      logs.find((log) => log.includes('Error: test timed out in 50ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:5:5')),
    ).toBeTruthy();

    expect(
      logs.find((log) => log.includes('Error: test timed out in 5000ms')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('Tests 1 failed | 1 passed')),
    ).toBeTruthy();
  }, 12000);
});
