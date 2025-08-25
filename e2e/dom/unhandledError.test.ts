import { describe, expect, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/unhandledError';

describe('jsdom', () => {
  it('should catch error correctly', async () => {
    const { cli } = await runCli(filters, 'jsdom');

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
  });
});

describe('happy-dom', () => {
  it('should catch error correctly', async () => {
    const { cli } = await runCli(filters, 'happy-dom');

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
  });
});
