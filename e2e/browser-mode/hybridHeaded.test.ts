import { describe, expect, it } from '@rstest/core';
import {
  runBrowserCli,
  shouldRunHeadedBrowserTests,
  shouldRunFirefoxBrowserTests,
} from './utils';

// Headed + headless hybrid runs and multi-headed runs: the host composes
// headless and headed lanes in the same cycle. Headed runs need a display, so
// CI arms them on headed-capable runners (macos/windows per
// .github/workflows/test.yml); locally opt in with RSTEST_E2E_RUN_HEADED=true
// and RSTEST_E2E_RUN_FIREFOX=true for the mixed-browser case.
describe('browser mode - headed + headless hybrid and multi-headed runs', () => {
  it.runIf(shouldRunHeadedBrowserTests && shouldRunFirefoxBrowserTests)(
    'runs one headed and one headless browser in the same cycle',
    async () => {
      // DEBUG=rstest exposes the per-launch host log for the headed proof.
      const { expectExecSuccess, cli } = await runBrowserCli('hybrid-headed', {
        env: { DEBUG: 'rstest' },
      });

      await expectExecSuccess();
      // One file copy per browser, each reported as its own project: the
      // run attributes through both the headed and the headless lane.
      expect(cli.stdout).toMatch(/\[rstest \(chromium\)\].*hybrid\.test\.ts/);
      expect(cli.stdout).toMatch(/\[rstest \(firefox\)\].*hybrid\.test\.ts/);
      expect(cli.stdout).toMatch(/Test Files 2 passed/);
      expect(cli.stdout).toMatch(/Tests 2 passed/);

      // Exactly one launch per (project, browser): the headed pair launches
      // headed once and the headless pair headlessly once.
      expect(
        cli.log.split('launching playwright/chromium (headed)').length - 1,
      ).toBe(1);
      expect(
        cli.log.split('launching playwright/firefox (headless)').length - 1,
      ).toBe(1);
      // The headed count must own the single headed launch: no other browser
      // may launch headed in this shape (close lines also say "(headed)").
      expect(
        cli.log.match(/\[Browser\] launching \S+ \(headed\)/g),
      ).toHaveLength(1);
    },
    60_000,
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'serializes the headed and headless lanes under pool.maxWorkers 1',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli(
        'hybrid-headed-max-workers',
      );

      await expectExecSuccess();
      const windows = [
        ...cli.stdout.matchAll(/^RUN_WINDOW (\d+) (\d+)$/gm),
      ].map((match) => ({
        start: Number(match[1]),
        end: Number(match[2]),
      }));
      // One copy per project, one on each lane.
      expect(windows).toHaveLength(2);
      const [first, second] = windows.sort((a, b) => a.start - b.start);
      // The later file starts only after the earlier one finished.
      expect(second!.start).toBeGreaterThanOrEqual(first!.end);
    },
    90_000,
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'runs multiple headed projects sharing one browser launch and respecting pool.maxWorkers 1',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli(
        'hybrid-headed-max-workers',
        {
          args: ['--browser.headless=false'],
          env: { DEBUG: 'rstest' },
        },
      );

      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Browser mode opened at .*\(headed\)/);
      expect(cli.stdout).toMatch(/Browser mode opened at .*\(headless\)/);
      expect(cli.stdout).toMatch(/Test Files 2 passed/);
      // Both headed Chromium projects share one launchKey -> 1 browser process.
      expect(
        cli.log.match(/\[Browser\] launching playwright\/chromium \(headed\)/g),
      ).toHaveLength(1);
      const windows = [
        ...cli.stdout.matchAll(/^RUN_WINDOW (\d+) (\d+)$/gm),
      ].map((match) => ({
        start: Number(match[1]),
        end: Number(match[2]),
      }));
      expect(windows).toHaveLength(2);
      const [first, second] = windows.sort((a, b) => a.start - b.start);
      expect(second!.start).toBeGreaterThanOrEqual(first!.end);
    },
    90_000,
  );
});
