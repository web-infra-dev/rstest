import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('vue', () => {
  it('should run vue SFC and JSX tests correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', 'jsx'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'Vue SFC component test passes under jsdom').toMatch(
      /✓ test\/index\.test\.ts/,
    );
    expect(
      cli.stdout,
      'Vue JSX (App.tsx) component test passes under jsdom',
    ).toMatch(/✓ test\/jsx\.test\.ts/);
    await expectExecSuccess();
  });

  it('should run vue SFC test correctly in browser mode', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '--config=rstest.browser.config.mts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
