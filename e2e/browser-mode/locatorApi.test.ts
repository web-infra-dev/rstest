import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

describe('browser mode - locator api', () => {
  it('should run locator API tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('locator-api');

    await expectExecSuccess();
    expect(cli.stdout).toContain('headedConcurrencySmoke.test.ts');
    expect(cli.stdout).toContain('locatorApi.test.ts');
    expect(cli.stdout).toMatch(/Test Files.*2.*passed/);
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it.skipIf(!shouldRunHeadedBrowserTests)(
    'should keep locator API working across multiple files in headed mode',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli('locator-api', {
        args: ['--browser.headless', 'false'],
      });

      await expectExecSuccess();
      expect(cli.stdout).toContain('headedConcurrencySmoke.test.ts');
      expect(cli.stdout).toContain('locatorApi.test.ts');
      expect(cli.stdout).toMatch(/Test Files.*2.*passed/);
      expect(cli.stdout).toMatch(/Tests.*passed/);
      expect(cli.stdout).not.toContain('/scheduler.html');
      expect(cli.stdout).not.toContain('test timed out');
    },
  );
});
