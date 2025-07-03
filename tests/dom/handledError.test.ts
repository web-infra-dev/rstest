import { describe, it } from '@rstest/core';
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
