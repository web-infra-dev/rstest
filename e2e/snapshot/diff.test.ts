import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const escapeChar = '\u001b';
const controlSequenceIntro = String.fromCodePoint(0x9b);
const vtControlSequenceRegex = new RegExp(
  `(?:${escapeChar}\\[[0-?]*[ -/]*[@-~]|${controlSequenceIntro}[0-?]*[ -/]*[@-~])`,
);

it('should show snapshot diff details', async () => {
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
  expect(output).toContain(escapeChar);
  expect(output).toMatch(vtControlSequenceRegex);

  const logs = cli.stderr.split('\n').filter(Boolean);
  const removedLine = logs.find((log) => log.includes('-     99"'));
  const addedLine = logs.find((log) => log.includes('+     100"'));

  expect(logs.length).toBeLessThan(100);
  expect(removedLine).toBeTruthy();
  expect(addedLine).toBeTruthy();
  expect(removedLine).toContain(escapeChar);
  expect(addedLine).toContain(escapeChar);
});

it('keeps diff lines plain when project env sets NO_COLOR in CI', async ({
  onTestFinished,
}) => {
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'diff.test.ts', '-c', 'rstest.noColor.config.mts'],
    stripAnsi: false,
    onTestFinished,
    unsetEnv: ['FORCE_COLOR', 'NO_COLOR'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
        env: { CI: 'true', RSTEST_NO_AGENT: '1' },
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);
  expect(`${cli.stdout}${cli.stderr}`).toContain(escapeChar);
  const lines = cli.stderr.split('\n');
  const removedLine = lines.find((line) => line.includes('-     99"'));
  const addedLine = lines.find((line) => line.includes('+     100"'));
  expect(removedLine).toBeTruthy();
  expect(addedLine).toBeTruthy();
  expect(removedLine).not.toContain(escapeChar);
  expect(addedLine).not.toContain(escapeChar);
});
