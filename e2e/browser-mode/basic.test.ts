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
    expect(cli.stdout).toContain('fileFixtures.test.ts');
    expect(cli.stdout).toContain('RSTEST_BROWSER_FILE_FIXTURE_CLEANUP_OK');
    expect(cli.stdout).toContain('retryContext.test.ts');
    expect(cli.stdout).toContain('signalContext.test.ts');
    expect(cli.stdout).toContain('RSTEST_BROWSER_CONTEXT_SIGNAL_ABORTED');
    expect(cli.stdout).not.toContain('/scheduler.html');
  });

  it('keeps worker fixtures alive across non-isolated browser files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: [
        '--isolate=false',
        '--pool.maxWorkers=1',
        'tests/workerScopeA.test.ts',
        'tests/workerScopeB.test.ts',
      ],
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_BROWSER_WORKER_SETUP_1');
    expect(cli.stdout).toContain('RSTEST_BROWSER_WORKER_CLEANUP_1');
    expect(cli.stdout).not.toContain('RSTEST_BROWSER_WORKER_SETUP_2');
  });

  it.runIf(shouldRunHeadedBrowserTests)(
    'should run headed mode and exit with code 0',
    async () => {
      const { cli } = await runBrowserCli('basic', {
        args: ['--browser.headless', 'false', 'tests/fileFixtures.test.ts'],
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
