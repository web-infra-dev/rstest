import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { runBrowserCli } from './utils';

/**
 * Browser launches and closes are logged by the host's launch pool; replaying
 * them in order gives the number of browsers open at once.
 */
const replayLaunchLog = (log: string) => {
  let open = 0;
  let peak = 0;
  let launched = 0;
  let closed = 0;
  for (const line of log.split('\n')) {
    if (line.includes('[Browser] launching')) {
      launched++;
      open++;
      peak = Math.max(peak, open);
    } else if (line.includes('[Browser] closed')) {
      closed++;
      open--;
    }
  }
  return { peak, launched, closed };
};

it('opens one browser at a time under pool.maxWorkers 1', async () => {
  const { expectExecSuccess, cli } = await runBrowserCli('launch-cap', {
    args: ['--pool.maxWorkers=1'],
    env: { DEBUG: 'rstest' },
  });

  await expectExecSuccess();
  expect(cli.stdout).toMatch(/Test Files 3 passed/);
  const { peak, launched, closed } = replayLaunchLog(cli.log);
  expect(peak).toBe(1);
  // Packed by launch: each browser opens once and every one is closed.
  expect(launched).toBe(3);
  expect(closed).toBe(3);
}, 120_000);

it('opens every browser at once when pool.maxWorkers allows it', async () => {
  const { expectExecSuccess, cli } = await runBrowserCli('launch-cap', {
    args: ['--pool.maxWorkers=3'],
    env: { DEBUG: 'rstest' },
  });

  await expectExecSuccess();
  expect(cli.stdout).toMatch(/Test Files 3 passed/);
  const { peak, launched, closed } = replayLaunchLog(cli.log);
  expect(peak).toBe(3);
  expect(launched).toBe(3);
  expect(closed).toBe(3);
}, 120_000);

const failureCwd = fileURLToPath(
  new URL('./fixtures/launch-cap-failure/', import.meta.url),
);

it.for(['run', 'watch'])(
  'fails fast on a launch that fails after another browser ran, in %s',
  async (command, { onTestFinished }) => {
    // runBrowserCli's CI chrome-channel injection would override the missing
    // executablePath, so the fixture applies the channel to `a` itself.
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [command],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: failureCwd,
          env: {
            DEBUG: 'rstest',
            CI: '',
            GITHUB_ACTIONS: '',
            // CI installs only the channel Chrome; the fixture hands it to `a`.
            ...(process.env.CI ? { RSTEST_E2E_CHROME_CHANNEL: 'chrome' } : {}),
          },
        },
      },
    });
    await cli.exec;

    expect(cli.exec.exitCode).toBe(1);
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(/Failed to launch/i);
    expect(output).toContain('nonexistent-browser-binary');
    if (command === 'watch') {
      // A launch that fails in the first cycle ends the session.
      expect(output).toContain('Failed to run Rstest.');
      expect(output).not.toContain('Waiting for file changes...');
    }
    // The browser that did launch is closed again, not leaked.
    const { launched, closed } = replayLaunchLog(cli.log);
    expect(launched).toBe(2);
    expect(closed).toBeGreaterThanOrEqual(1);
  },
  120_000,
);
