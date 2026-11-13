import { expect, it } from '@rstest/core';
import { runRstestCli } from './index';

it('shares process completion across many pending output waits', async () => {
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => warnings.push(warning);
  process.on('warning', onWarning);
  try {
    const { cli } = await runRstestCli({
      command: process.execPath,
      args: ['-e', "process.stdout.write('ready');", '--'],
    });
    await Promise.all(
      Array.from({ length: 20 }, () => cli.waitForStdout('ready')),
    );
    await cli.exec;
    expect(warnings).toEqual([]);
  } finally {
    process.off('warning', onWarning);
  }
});

it.for(['stdout', 'stderr'] as const)(
  'waits for %s output and accepts output buffered before exit',
  async (stream) => {
    const { cli } = await runRstestCli({
      command: process.execPath,
      args: ['-e', `process.${stream}.write('ready');`, '--'],
    });

    if (stream === 'stdout') {
      await cli.waitForStdout('ready');
    } else {
      await cli.waitForStderr('ready');
    }
    await cli.exec;

    if (stream === 'stdout') {
      await cli.waitForStdout(/ready/);
    } else {
      await cli.waitForStderr(/ready/);
    }
    expect(cli.exec.process?.exitCode).toBe(0);
  },
);

it.for([
  { stream: 'stdout', code: 0 },
  { stream: 'stderr', code: 0 },
  { stream: 'stdout', code: 7 },
  { stream: 'stderr', code: 7 },
])(
  'rejects missing $stream output when the CLI exits with code $code',
  async ({ stream, code }) => {
    const { cli } = await runRstestCli({
      command: process.execPath,
      args: [
        '-e',
        `process.stderr.write('startup diagnostic'); process.exitCode = ${code};`,
        '--',
      ],
    });
    const waitForMissingOutput = () =>
      stream === 'stdout'
        ? cli.waitForStdout('missing')
        : cli.waitForStderr('missing');
    const error = new RegExp(
      `CLI exited with code ${code} before matching ${stream}: missing[\\s\\S]*startup diagnostic`,
    );

    await expect(waitForMissingOutput()).rejects.toThrow(error);
    await cli.exec;
    await expect(waitForMissingOutput()).rejects.toThrow(error);
  },
);
