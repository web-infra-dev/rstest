import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { parseMarkerPayload, runRstestCli } from '../scripts';

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
