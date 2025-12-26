import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { remove } from 'fs-extra';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('restart', () => {
  it('should restart when rstest config file changed', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-1${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath,
    });

    const configFile = path.join(fixturesTargetPath, 'rstest-1.config.mjs');
    await remove(configFile);

    fs.create(
      configFile,
      `import { defineConfig } from '@rstest/core';
export default defineConfig({});
      `,
    );

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept', '-c', configFile],
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    // initial run
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 passed');

    // trigger restart by updating config file
    cli.resetStd();
    fs.update(configFile, (content) => `${content}\n// trigger restart`);

    await cli.waitForStdout('restart');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 1 passed');

    cli.exec.kill();
  });
});
