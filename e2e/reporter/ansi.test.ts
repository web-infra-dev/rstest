import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ansi', () => {
  it('disables ansi output for snapshot diffs when AI agent is detected', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'ansi.test.ts'],
      stripAnsi: false,
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            AI_AGENT: 'cursor-cli',
          },
        },
      },
    });

    await cli.exec;

    const output = `${cli.stdout}${cli.stderr}`;
    const escapeChar = '\u001b';
    const vtControlSequenceRegex =
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching VT control sequences
      /(?:\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~])/;

    expect(output).not.toContain(escapeChar);
    expect(output).not.toMatch(vtControlSequenceRegex);
  });
});
