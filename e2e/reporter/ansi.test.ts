import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const escapeChar = '\u001b';
const vtControlSequenceRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching VT control sequences
  /(?:\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~])/;

describe('ansi', () => {
  it('disables ansi output for snapshot diffs in non-tty environments', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'ansi.test.ts'],
      stripAnsi: false,
      onTestFinished,
      unsetEnv: ['FORCE_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            NO_COLOR: '1',
          },
        },
      },
    });

    await cli.exec;

    const output = `${cli.stdout}${cli.stderr}`;

    expect(output).not.toContain(escapeChar);
    expect(output).not.toMatch(vtControlSequenceRegex);
  });

  it('enables ansi output for snapshot diffs when FORCE_COLOR is set', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'ansi.test.ts'],
      stripAnsi: false,
      onTestFinished,
      unsetEnv: ['NO_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            FORCE_COLOR: '1',
          },
        },
      },
    });

    await cli.exec;

    const output = `${cli.stdout}${cli.stderr}`;

    expect(output).toContain(escapeChar);
    expect(output).toMatch(vtControlSequenceRegex);
  });
});
