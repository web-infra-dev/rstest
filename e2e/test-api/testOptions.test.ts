import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('TestOptions', () => {
  it('options.retry overrides config.retry both up and down', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRetryOverride.test.ts', '--retry=5'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    // Second case sets retry: 0 and always throws, so the file fails overall.
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);
    // 1 passed (extending retry beyond config), 1 failed (retry: 0 disables).
    expectLog(/Tests 1 failed/, logs);
    expectLog(/1 passed/, logs);
    // The failing case ran exactly once (no retries via config.retry=5).
    expectLog(/attempt 1$/, cli.stderr.split('\n').filter(Boolean));
    expect(cli.stderr).not.toContain('attempt 2');
  });
});
