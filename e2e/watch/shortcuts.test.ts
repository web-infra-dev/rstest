import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CLI shortcuts', () => {
  it('CLI shortcuts should display and work as expected', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-shortcuts`;
    await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures-shortcuts`,
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch'],
      options: {
        nodeOptions: {
          env: {
            FORCE_TTY: 'true',
            CI: undefined,
          },
          cwd: fixturesTargetPath,
        },
      },
    });

    // initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed | 1 passed');

    await cli.waitForStdout('press h to show help');

    cli.exec.process!.stdin!.write('h');

    await cli.waitForStdout('Shortcuts:');
    expect(cli.stdout).toMatch('a  rerun all tests');
    expect(cli.stdout).toMatch('u  update snapshot');

    cli.resetStd();

    // rerun all tests
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed | 1 passed');

    cli.exec.kill();
  });

  it('shortcut `f` should works as expected', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-shortcuts-f`;
    await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures-shortcuts`,
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch'],
      options: {
        nodeOptions: {
          env: {
            FORCE_TTY: 'true',
            CI: undefined,
          },
          cwd: fixturesTargetPath,
        },
      },
    });

    // initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed | 1 passed');

    await cli.waitForStdout('press h to show help');

    cli.resetStd();

    // rerun failed tests
    cli.exec.process!.stdin!.write('f');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed');

    cli.exec.kill();
  });
});
