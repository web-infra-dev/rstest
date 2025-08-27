import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { remove } from 'fs-extra';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

rs.setConfig({
  retry: 3,
});

describe('restart', () => {
  it('should restart when rstest config file changed', async () => {
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath: `${__dirname}/fixtures-test-1`,
    });

    const configFile = path.join(
      __dirname,
      'fixtures-test-1/rstest-1.config.mjs',
    );
    await remove(configFile);

    fs.create(
      configFile,
      `import { defineConfig } from '@rstest/core';
export default defineConfig({
  name: 'restart',
  tools: {
    rspack: {
      watchOptions: {
        ignored: '**/**'
      },
    },
  },
});
      `,
    );

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept', '-c', configFile],
      options: {
        nodeOptions: {
          cwd: `${__dirname}/fixtures-test-1`,
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
