import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const escapeChar = '\u001b';
const controlSequenceIntro = String.fromCodePoint(0x9b);
const vtControlSequenceRegex = new RegExp(
  `(?:${escapeChar}\\[[0-?]*[ -/]*[@-~]|${controlSequenceIntro}[0-?]*[ -/]*[@-~])`,
);

describe('ansi', () => {
  it.for([
    {
      name: 'disables ansi output when NO_COLOR is set',
      env: { NO_COLOR: '1' },
      unsetEnv: ['FORCE_COLOR'],
      expectAnsi: false,
    },
    {
      name: 'disables ansi output in agent sessions',
      env: { AI_AGENT: 'x', CI: 'true' },
      unsetEnv: ['FORCE_COLOR', 'NO_COLOR', 'RSTEST_NO_AGENT'],
      expectAnsi: false,
    },
    {
      name: 'disables ansi output in piped non-CI sessions',
      env: { RSTEST_NO_AGENT: '1' },
      unsetEnv: ['FORCE_COLOR', 'NO_COLOR', 'CI'],
      expectAnsi: false,
      skipOnWin32: true,
    },
  ])(
    '$name',
    async (
      { env, unsetEnv, expectAnsi, skipOnWin32 },
      { onTestFinished, skip },
    ) => {
      if (skipOnWin32 && process.platform === 'win32') {
        skip();
      }
      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['run', 'ansi.test.ts'],
        stripAnsi: false,
        onTestFinished,
        unsetEnv,
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
            env,
          },
        },
      });

      await cli.exec;
      const output = `${cli.stdout}${cli.stderr}`;
      expect(cli.exec.process?.exitCode).toBe(1);
      expect(output).toContain('hi222');
      expect(output.includes(escapeChar)).toBe(expectAnsi);
      expect(vtControlSequenceRegex.test(output)).toBe(expectAnsi);
    },
  );
});
