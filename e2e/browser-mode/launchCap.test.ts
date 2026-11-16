import { expect, it } from '@rstest/core';
import { replayLaunchLog, runBrowserCli } from './utils';

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
