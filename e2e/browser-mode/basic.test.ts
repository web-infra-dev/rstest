import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

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
    expect(cli.stdout).toContain('retryContext.test.ts');
    expect(cli.stdout).not.toContain('/scheduler.html');
  });

  it('should run scoped fixture lifecycles in the browser runner', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: ['tests/scopedFixtures.test.ts'],
    });

    await expectExecSuccess();
    expect(cli.stdout).toMatch(
      /browser-scope:worker:setup[\s\S]*browser-scope:file:setup[\s\S]*browser-scope:test:setup:1[\s\S]*browser-scope:test:cleanup:worker:file:test:1[\s\S]*browser-scope:test:setup:2[\s\S]*browser-scope:test:cleanup:worker:file:test:2[\s\S]*browser-scope:file:cleanup[\s\S]*browser-scope:worker:cleanup/,
    );
  });

  it('should report browser worker fixture cleanup failures', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.worker-cleanup.config.mts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'browser worker fixture cleanup reached',
    );
  });

  it('should clean up browser worker fixtures after a fatal error', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.worker-cleanup-after-fatal.config.mts'],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('browser fatal after worker fixture setup');
    expect(output).toContain('browser worker cleanup after fatal reached');
  });

  it('should bound browser worker fixture cleanup', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.worker-cleanup-timeout.config.mts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'Browser worker fixture cleanup did not finish within 10000ms',
    );
  });

  it('should bound browser file fixture cleanup', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.file-cleanup-timeout.config.mts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'Browser file fixture cleanup did not finish within 10000ms',
    );
  });

  it('should capture unhandled errors from browser worker cleanup', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.worker-cleanup-unhandled.config.mts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'unhandled browser worker cleanup rejection',
    );
  });

  it.runIf(shouldRunHeadedBrowserTests)(
    'should wait for browser worker cleanup failures in headed mode',
    async () => {
      const { expectExecFailed, cli } = await runBrowserCli('basic', {
        args: [
          '-c',
          'rstest.worker-cleanup.config.mts',
          '--browser.headless',
          'false',
        ],
      });

      await expectExecFailed();
      expect(`${cli.stdout}\n${cli.stderr}`).toContain(
        'browser worker fixture cleanup reached',
      );
    },
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should bound browser worker fixture cleanup in headed mode',
    async () => {
      const { expectExecFailed, cli } = await runBrowserCli('basic', {
        args: [
          '-c',
          'rstest.worker-cleanup-timeout.config.mts',
          '--browser.headless',
          'false',
        ],
      });

      await expectExecFailed();
      expect(`${cli.stdout}\n${cli.stderr}`).toContain(
        'Browser worker fixture cleanup did not finish within 10000ms',
      );
    },
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should bound browser file fixture cleanup in headed mode',
    async () => {
      const { expectExecFailed, cli } = await runBrowserCli('basic', {
        args: [
          '-c',
          'rstest.file-cleanup-timeout.config.mts',
          '--browser.headless',
          'false',
        ],
      });

      await expectExecFailed();
      expect(`${cli.stdout}\n${cli.stderr}`).toContain(
        'Browser file fixture cleanup did not finish within 10000ms',
      );
    },
  );

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
});
