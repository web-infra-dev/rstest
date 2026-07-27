import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('exit code - never downgrade', () => {
  it('should preserve a pre-set non-zero exit code when a test fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/preset-exit-code'),
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();

    // The failing test would normally set the code to 1, but the reporter
    // pinned it to 42 in `onTestRunStart`; never-downgrade keeps 42.
    expect(cli.exec.process?.exitCode).toBe(42);
  });

  it('should not clear a pre-set non-zero exit code on an empty run', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/empty-preset-exit-code'),
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();

    // No test files + `passWithNoTests` resolves to code 0, but the reporter
    // pre-set 42; `reportNoTestFiles` must never clear a prior non-zero code
    // to 0 (RFC 2c second clause).
    expect(cli.stdout).toContain('No test files found');
    expect(cli.exec.process?.exitCode).toBe(42);
  });
});
