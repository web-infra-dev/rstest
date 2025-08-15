import { describe, expect, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/handledError';

describe('jsdom', () => {
  it('should handle error correctly', async () => {
    const { expectExecSuccess, cli } = await runCli(filters, 'jsdom');
    await cli.exec;
    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should handle error correctly', async () => {
    const { expectExecSuccess, cli } = await runCli(filters, 'happy-dom');
    await cli.exec;
    await expectExecSuccess();
  });
});

describe('custom-environment', () => {
  it('should throw error when unknown environment', async () => {
    const { cli } = await runCli(filters, 'custom-environment');
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) =>
        log.includes('Unknown test environment: custom-environment'),
      ),
    ).toBeDefined();
  });
});
