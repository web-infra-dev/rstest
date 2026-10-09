import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/handledError';

describe('custom-environment', () => {
  it('should throw error when unknown environment', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      filters,
      'custom-environment',
    );
    await expectExecFailed();

    expectStderrLog(/Unknown test environment: custom-environment/);
  });
});
