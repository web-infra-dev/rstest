import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/css';

describe('jsdom', () => {
  it('should run css test correctly', async () => {
    const { expectExecSuccess } = await runCli(filters, 'jsdom');
    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should run css test correctly', async () => {
    const { expectExecSuccess } = await runCli(filters, 'happy-dom');
    await expectExecSuccess();
  });
});
