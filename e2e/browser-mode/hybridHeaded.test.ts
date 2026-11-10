import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

// One headed (project, browser) pair beside headless rows is a legal RUN
// shape: the host composes one headed lane with headless lanes in the same
// cycle (watch would reject this set; validation owns that). Headed runs need
// a display, so CI arms them on headed-capable runners (macos/windows per
// .github/workflows/test.yml); locally opt in with RSTEST_E2E_RUN_HEADED=true.
describe('browser mode - one headed + headless hybrid run', () => {
  it.runIf(shouldRunHeadedBrowserTests)(
    'runs one headed and one headless browser in the same cycle',
    async () => {
      // DEBUG=rstest exposes the per-launch host log for the headed proof.
      const { expectExecSuccess, cli } = await runBrowserCli('hybrid-headed', {
        env: { DEBUG: 'rstest' },
      });

      await expectExecSuccess();
      // One file copy per browser, each row tagged with its browser: the
      // run attributions through both the headed and the headless lane.
      expect(cli.stdout).toMatch(/\[chromium\].*hybrid\.test\.ts/);
      expect(cli.stdout).toMatch(/\[firefox\].*hybrid\.test\.ts/);
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
      // may run headed in this shape.
      expect(cli.log.split('(headed)').length - 1).toBe(1);
    },
    60_000,
  );
});
