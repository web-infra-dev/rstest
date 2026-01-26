import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should show diff as expected', async () => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/diff.test.ts'],
    stripAnsi: false,
    unsetEnv: ['NO_COLOR'],
    options: {
      nodeOptions: {
        cwd: __dirname,
        env: {
          FORCE_COLOR: '1',
        },
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const output = `${cli.stdout}${cli.stderr}`;
  const escapeChar = '\u001b';
  const vtControlSequenceRegex =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching VT control sequences
    /(?:\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~])/;

  // Snapshot diff output should keep ANSI color by default.
  expect(output).toContain(escapeChar);
  expect(output).toMatch(vtControlSequenceRegex);

  const logs = cli.stderr.split('\n').filter(Boolean);

  expect(logs.length).toBeLessThan(100);
  expect(logs.find((log) => log.includes('-     99"'))).toBeTruthy();
  expect(logs.find((log) => log.includes('+     100"'))).toBeTruthy();
});
