import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test timeout', () => {
  it('should throw timeout error when test timeout', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/timeout.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Error: test timed out in 50ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:5:3')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Error: test timed out in 5000ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:10:3')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 failed'))).toBeTruthy();
  }, 10000);
});
