import { describe, expect, it } from '@rstest/core';
import { sleep } from '../scripts';
import {
  runBrowserCli,
  runBrowserWatchCli,
  shouldRunHeadedBrowserTests,
} from './utils';

describe('browser mode - basic', () => {
  it.each([
    { args: [], runs: 3 },
    { args: ['--repeats=0'], runs: 1 },
  ])('repeats individual browser tests with $args', async ({ args, runs }) => {
    const { cli, expectExecSuccess } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.repeats.config.mts', ...args],
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain(
      `REPEATS_EVENTS:${[
        ...Array(runs).fill('A'),
        ...Array(runs).fill('B'),
        'explicit',
        'explicit',
        'explicit',
        'suite',
        'suite',
        'disabled',
        'nested',
      ].join(',')}`,
    );
    expect(cli.stdout).toMatch(/Tests\s+6 passed/);
  });

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

  it.each(['default', 'stack', 'list', 'parallel'])(
    'runs hooks in %s order',
    async (hooks) => {
      const { cli, expectExecSuccess } = await runBrowserCli('basic', {
        args: ['-c', 'rstest.sequence.config.mts'],
        env: { HOOK_ORDER: hooks },
      });

      await expectExecSuccess();
      expect(cli.stdout).toContain(
        `HOOK_ORDER_OK:${hooks === 'default' ? 'stack' : hooks}`,
      );
    },
  );

  it.each(['fixture-error', 'fixture-timeout'])(
    'preserves sibling hooks after parallel %s',
    async (failure) => {
      const { cli } = await runBrowserCli('basic', {
        args: ['-c', 'rstest.sequence.config.mts'],
        env: { HOOK_ORDER: 'parallel', HOOK_FAILURE: failure },
      });
      await cli.exec;
      expect(cli.exec.exitCode).toBe(1);
      for (const hook of ['beforeEach', 'afterEach']) {
        expect(cli.stderr).toContain(
          failure === 'fixture-error'
            ? `FIXTURE_SETUP_FAILED:${hook}:unrelated`
            : `${hook} hook timed out in 50ms`,
        );
        for (const scope of failure === 'fixture-timeout'
          ? ['unrelated', 'shared']
          : ['unrelated']) {
          expect(cli.stderr).toContain(`SIBLING_HOOK_FAILED:${hook}:${scope}`);
          expect(cli.stdout).toContain(
            `PARALLEL_FIXTURES_DRAINED:${hook}:${scope}`,
          );
        }
      }
    },
  );

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
    60_000,
  );
});
