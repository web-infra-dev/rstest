import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

describe('virtual test entries', () => {
  it('runs virtual entries injected via experiments.VirtualModulesPlugin', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--reporter=verbose'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('virtual/sum.test.ts');
    expect(cli.stdout).toContain('virtual/diff.test.ts');
    expect(cli.stdout).toContain('virtual sum > 1 + 1 = 2');
    expect(cli.stdout).toContain('virtual diff > 3 - 1 = 2');
    expect(cli.stdout).toContain('Test Files 2 passed');
  });

  it('lists virtual entries', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    expect(cli.stdout).toContain('virtual/sum.test.ts');
    expect(cli.stdout).toContain('virtual/diff.test.ts');
  });

  it('matches virtual entries via fileFilter', async ({ onTestFinished }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'sum', '--reporter=verbose'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('virtual sum > 1 + 1 = 2');
    expect(cli.stdout).not.toContain('virtual diff');
  });
});
