import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  runBrowserCli,
  shouldRunHeadedBrowserTests,
  shouldRunFirefoxBrowserTests,
  runBrowserWatchCliWithCwd,
  killCliProcessTree,
  deleteFixtureTarget,
} from './utils';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/viewport',
);

describe('browser mode - viewport', () => {
  it('should apply viewport config to runner iframe', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('viewport');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should apply preset viewport config to runner iframe', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('viewport-preset');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('restores viewports with isolation disabled', async () => {
    const { expectExecSuccess } = await runBrowserCli('viewport', {
      args: ['--isolate=false'],
    });
    await expectExecSuccess();
  });

  it('restores viewports across watch reruns', async () => {
    const target = join(dirname(fixtureRoot), 'fixtures-test-viewport-watch');
    const { fs } = await prepareFixtures({
      fixturesPath: fixtureRoot,
      fixturesTargetPath: target,
    });
    const { cli } = await runBrowserWatchCliWithCwd(target);
    try {
      await cli.waitForStdout('Tests 28 passed');
      await cli.waitForStdout('Waiting for file changes...');
      cli.resetStd();
      fs.update(
        join(target, 'tests/viewport.test.ts'),
        (source) => `${source}\n// watch viewport rerun\n`,
      );
      await cli.waitForStdout('Tests 28 passed');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.log).not.toContain('AssertionError');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, target);
    }
  });

  it('restores viewports without an explicit size', async () => {
    const { expectExecSuccess } = await runBrowserCli('viewport', {
      args: ['--config', 'rstest.full.config.mts'],
    });
    await expectExecSuccess();
  });

  it('keeps mobile-emulated viewport scale stable', async () => {
    const { expectExecSuccess } = await runBrowserCli('viewport', {
      args: ['--config', 'rstest.mobile.config.mts'],
    });
    await expectExecSuccess();
  });

  it('ends the file if restoring its viewport fails', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('viewport', {
      args: ['--config', 'rstest.restore-error.config.mts'],
    });
    await expectExecFailed();
    expect(cli.log).toContain(
      'Failed to restore the browser viewport after a test.',
    );
    expect(cli.log).toContain('VIEWPORT_RESTORE_REJECTED');
    expect(cli.log).not.toContain('VIEWPORT_CONTAMINATED_TEST_RAN');
  });

  it('ends the file if a pending viewport request blocks cleanup', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('viewport', {
      args: [
        '--config',
        'rstest.restore-error.config.mts',
        '--testNamePattern',
        'pending viewport request|contaminated viewport',
      ],
    });
    await expectExecFailed();
    expect(cli.log).toContain('VIEWPORT_PENDING_STARTED');
    expect(cli.log).toContain('Viewport cleanup did not finish within 100ms');
    expect(cli.log).not.toContain('VIEWPORT_CONTAMINATED_TEST_RAN');
  });

  it('restores the viewport after failures, timeouts and failed cleanup, after capturing screenshots', async () => {
    for (const headless of shouldRunHeadedBrowserTests
      ? [true, false]
      : [true]) {
      const { cli, expectExecFailed } = await runBrowserCli('viewport', {
        args: [
          '--config',
          'rstest.failure.config.mts',
          '--browser.headless',
          String(headless),
        ],
      });
      try {
        await expectExecFailed();
        expect(cli.stdout).toMatch(/Tests\s+3 failed \| 3 passed/);
        for (const name of ['FAILURE', 'TIMEOUT', 'CLEANUP']) {
          expect(cli.stdout).toContain(`VIEWPORT_AFTER_${name} 390`);
        }
        const screenshots = readdirSync(fixtureRoot, { recursive: true })
          .map((entry) => join(fixtureRoot, entry.toString()))
          .filter((entry) => /viewport\.test\.ts-.*\.png$/.test(entry));
        expect(screenshots).toHaveLength(3);
        const scale = Number(
          /VIEWPORT_DEVICE_SCALE ([\d.]+)/.exec(cli.stdout)?.[1],
        );
        expect(scale).toBeGreaterThan(0);
        const dimensions = screenshots.map((path) => {
          const png = readFileSync(path);
          return [png.readUInt32BE(16) / scale, png.readUInt32BE(20) / scale];
        });
        expect(dimensions).toEqual(
          expect.arrayContaining([
            [600, 400],
            [610, 410],
            [620, 420],
          ]),
        );
      } finally {
        rmSync(join(fixtureRoot, '.rstest', 'screenshots'), {
          recursive: true,
          force: true,
        });
      }
    }
  });

  it.skipIf(!shouldRunFirefoxBrowserTests)(
    'resizes and restores Firefox viewports',
    async () => {
      const { expectExecSuccess } = await runBrowserCli('viewport', {
        args: [
          '--config',
          'rstest.instances.config.mts',
          '--browser.instances=firefox',
        ],
      });
      await expectExecSuccess();
    },
  );

  it('restores per-instance viewport overrides in WebKit', async () => {
    const { expectExecSuccess } = await runBrowserCli('viewport', {
      args: [
        '--config',
        'rstest.instances.config.mts',
        '--browser.instances=webkit',
      ],
    });
    await expectExecSuccess();
  });

  it.skipIf(!shouldRunHeadedBrowserTests)(
    'should apply viewport config in headed mode without scheduler page',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli('viewport', {
        args: ['--browser.headless', 'false'],
      });

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests.*passed/);
      expect(cli.stdout).not.toContain('/scheduler.html');

      const full = await runBrowserCli('viewport', {
        args: [
          '--config',
          'rstest.full.config.mts',
          '--browser.headless',
          'false',
        ],
      });
      await full.expectExecSuccess();
    },
  );
});
