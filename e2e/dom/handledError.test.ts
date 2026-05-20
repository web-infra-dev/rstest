import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/handledError';

describe('jsdom', () => {
  it('should handle error correctly', async () => {
    const { expectExecSuccess } = await runCli(filters, 'jsdom');
    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should handle error correctly', async () => {
    const { expectExecSuccess } = await runCli(filters, 'happy-dom');
    await expectExecSuccess();
  });
});

describe('custom-environment', () => {
  it('should throw error when unknown environment', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      filters,
      'custom-environment',
    );
    await expectExecFailed();

    expectStderrLog(
      /Failed to resolve testEnvironment "custom-environment"/,
    );
  });
});

describe('prototype-environment-name', () => {
  it('should throw an explicit resolution error for prototype property names', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      filters,
      'toString',
    );
    await expectExecFailed();

    expectStderrLog(/Failed to resolve testEnvironment "toString"/);
  });
});
