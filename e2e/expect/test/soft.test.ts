import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

describe('Expect Soft API', () => {
  it('should mark the test as fail and continue', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/soft.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stderr.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('AssertionError: expected 2 to be 3')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('AssertionError: expected 3 to be 4')),
    ).toBeTruthy();
    expect(cli.stdout).toContain('✓ expect.soft retry can recover');
    expect(
      logs.filter((log) =>
        log.includes('AssertionError: expected 1 to be 100'),
      ),
    ).toHaveLength(1);
    expect(
      logs.filter((log) =>
        log.includes('AssertionError: expected 2 to be 100'),
      ),
    ).toHaveLength(1);
  });
});
