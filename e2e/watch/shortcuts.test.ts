import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli, sleep } from '../scripts/';

rs.setConfig({
  retry: 3,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CLI shortcuts', () => {
  it('CLI shortcuts should display and work as expected', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-shortcuts${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;
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
    expect(cli.stdout).toMatch('Run all tests in project');

    cli.exec.process!.stdin!.write('h');

    await cli.waitForStdout('Shortcuts:');
    expect(cli.stdout).toMatch('a  rerun all tests');
    expect(cli.stdout).toMatch('u  update snapshot');

    cli.resetStd();

    // rerun all tests
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed | 1 passed');
    expect(cli.stdout).toMatch('Run all tests');

    // The `a` cycle's rebuild queues one trailing empty on-demand cycle; let
    // it settle so the `f` waits below anchor on the `f` cycle's own output.
    await sleep(1000);
    cli.resetStd();

    // rerun failed tests — the failing file stays failing across the `a`
    // cycle above, so `f` has a stable selection in the same session.
    cli.exec.process!.stdin!.write('f');
    await cli.waitForStdout('Run filtered tests');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 failed');

    cli.exec.process!.stdin!.write('q');

    await sleep(1000);

    cli.exec.kill();
  });
});
