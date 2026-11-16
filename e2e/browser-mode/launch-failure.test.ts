import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { parseMarkerPayload, runRstestCli } from '../scripts';
import { replayLaunchLog, runBrowserCli, runBrowserWatchCli } from './utils';

const cwd = fileURLToPath(
  new URL('./fixtures/launch-failure/', import.meta.url),
);
const hooks = ['onTestRunStart', 'onTestRunEnd', 'onExit'];

it.for(['run', 'watch'])(
  'finalizes a failed browser launch in %s',
  async (command, { onTestFinished }) => {
    // runBrowserCli's CI chrome-channel injection would override executablePath.
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [command],
      onTestFinished,
      options: { nodeOptions: { cwd } },
    });
    await cli.exec;

    expect(cli.exec.exitCode).toBe(1);
    expect(parseMarkerPayload(cli.stdout, '__LIFECYCLE__')).toEqual({
      hooks,
      errors: [
        expect.objectContaining({
          message: expect.stringContaining('nonexistent-browser-binary'),
        }),
      ],
    });
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('Unhandled Error');
    expect(output).toContain('Test Files no tests');
    if (command === 'run') {
      expect(output).toMatch(/Failed to launch/i);
      expect(output).not.toMatch(/expected.*to.*be/i);
      expect(output).not.toContain('Failed to run Rstest.');
    } else {
      expect(output).toContain('Failed to run Rstest.');
      expect(output).not.toContain('Waiting for file changes...');
    }
  },
);

it.for(['run', 'watch'])(
  'fails fast on a launch that fails after another browser ran, in %s',
  async (command) => {
    const { cli } = await (command === 'run'
      ? runBrowserCli('launch-cap-failure', { env: { DEBUG: 'rstest' } })
      : runBrowserWatchCli('launch-cap-failure'));
    await cli.exec;

    expect(cli.exec.exitCode).toBe(1);
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(/Failed to launch/i);
    expect(output).toContain('nonexistent-browser-binary');
    if (command === 'watch') {
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
