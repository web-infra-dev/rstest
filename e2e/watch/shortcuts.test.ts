import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts/';

rs.setConfig({
  retry: 3,
});

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
            DEBUG: 'rstest',
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
    expect(cli.stdout).toMatch('Fully run test files for first run.');

    cli.exec.process!.stdin!.write('h');

    await cli.waitForStdout('Shortcuts:');
    expect(cli.stdout).toMatch('a  rerun all tests');
    expect(cli.stdout).toMatch('u  update snapshot');

    cli.resetStd();

    // rerun all tests
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed | 1 passed');
    expect(cli.stdout).toMatch('Run all tests.');

    cli.exec.kill();
  });

  it('shortcut `f` should work as expected', async () => {
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
            DEBUG: 'rstest',
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
    expect(cli.stdout).toMatch('Fully run test files for first run.');
    cli.resetStd();

    // rerun failed tests
    cli.exec.process!.stdin!.write('f');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed');
    expect(cli.stdout).toMatch('Run filtered tests.');

    cli.exec.kill();
  });
});
