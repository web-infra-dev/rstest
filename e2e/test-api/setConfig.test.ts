import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('setConfig', () => {
  it('should throw timeout error when test timeout', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/setConfig.test'],
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
    expect(logs.find((log) => log.includes('Tests 2 failed'))).toBeTruthy();
  });
});
