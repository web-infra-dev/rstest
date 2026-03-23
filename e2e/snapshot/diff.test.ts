import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const escapeChar = '\u001b';
const shouldExpectColor =
  process.env.NO_COLOR === undefined &&
  (process.env.FORCE_COLOR !== undefined ||
    process.platform === 'win32' ||
    (process.stdout.isTTY && process.env.TERM !== 'dumb') ||
    process.env.CI !== undefined);
const vtControlSequenceRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching VT control sequences
  /(?:\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~])/;

it('should show snapshot diff details', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/diff.test.ts'],
    stripAnsi: false,
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const output = `${cli.stdout}${cli.stderr}`;
  if (shouldExpectColor) {
    expect(output).toContain(escapeChar);
    expect(output).toMatch(vtControlSequenceRegex);
  } else {
    expect(output).not.toContain(escapeChar);
    expect(output).not.toMatch(vtControlSequenceRegex);
  }

  const logs = cli.stderr.split('\n').filter(Boolean);
  const removedLine = logs.find((log) => log.includes('-     99"'));
  const addedLine = logs.find((log) => log.includes('+     100"'));

  expect(logs.length).toBeLessThan(100);
  expect(removedLine).toBeTruthy();
  expect(addedLine).toBeTruthy();
  if (shouldExpectColor) {
    expect(removedLine).toContain(escapeChar);
    expect(addedLine).toContain(escapeChar);
  }
});
