import { describe, expect, it } from '@rstest/core';
import { sleep } from '../scripts';
import {
  runBrowserCli,
  runBrowserWatchCli,
  shouldRunHeadedBrowserTests,
} from './utils';

describe('browser mode - basic', () => {
  it('should run DOM, event, and async tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files.*passed/);
    expect(cli.stdout).toContain('dom.test.ts');
    expect(cli.stdout).toContain('events.test.ts');
    expect(cli.stdout).toContain('async.test.ts');
    expect(cli.stdout).toContain('fakeTimers.test.ts');
    expect(cli.stdout).toContain('spy.test.ts');
    expect(cli.stdout).toContain('fixtures.test.ts');
    expect(cli.stdout).not.toContain('/scheduler.html');
  });

  it.runIf(shouldRunHeadedBrowserTests)(
    'should run headed mode and exit with code 0',
    async () => {
      const { cli } = await runBrowserCli('basic', {
        args: ['--browser.headless', 'false', 'tests/dom.test.ts'],
      });

      await cli.exec;
      expect(cli.exec.exitCode).toBe(0);
    },
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should serve the Browser UI when user plugins generate an index HTML',
    async () => {
      const { cli } = await runBrowserCli('basic', {
        args: ['-c', 'rstest.userHtml.config.mts'],
      });

      await cli.exec;
      expect(cli.exec.exitCode).toBe(0);
    },
  );
  it.runIf(shouldRunHeadedBrowserTests)(
    'should collect federation tests in headed watch mode',
    async () => {
      const result = await runBrowserWatchCli('basic', {
        args: ['-c', 'rstest.federationWatch.config.mts', 'tests/dom.test.ts'],
      });
      const { cli } = result;

      await cli.waitForStdout('Test Files 1 passed');
      expect(cli.stdout).toContain('dom.test.ts');
      if (!cli.stdout.includes('Waiting for file changes...')) {
        await cli.waitForStdout('Waiting for file changes...');
      }

      await sleep(1000);
      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
    },
    30_000,
  );
});
