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
    expect(cli.stdout).toMatch('Tests 2 passed');

    // trigger restart by updating config file
    cli.resetStd();
    fs.update(configFile, (content) => `${content}\n// trigger restart`);

    await cli.waitForStdout('restart');
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Tests 2 passed');

    // Ensure we kill the entire process tree (important on Windows where child
    // processes may survive and keep the test worker alive).
    cli.exec.kill();

    // Give the OS a moment to release file handles (especially on Windows CI).
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it('should restart when a root config dependency changes', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures-test-config-dependency${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath,
    });
    const configFile = path.join(fixturesTargetPath, 'config.mjs');
    const dependency = path.join(fixturesTargetPath, 'shared.mjs');
    fs.create(dependency, 'export default {};');
    fs.create(configFile, "export { default } from './shared.mjs';");

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '-c', configFile],
      options: { nodeOptions: { cwd: fixturesTargetPath } },
    });
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('Tests 2 passed');

    cli.resetStd();
    fs.update(dependency, (content) => `${content}\n// trigger restart`);
    await cli.waitForStdout('restarting Rstest as shared.mjs changed');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('Tests 2 passed');
  });

  it('watches project config dependencies', async () => {
    const root = `${__dirname}/fixtures-test-project-dependencies-${process.env.RSTEST_OUTPUT_MODULE}`;
    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures`,
      fixturesTargetPath: root,
    });
    const configs = {
      'root.config.mjs':
        "export default { projects: ['./parent.config.mjs'] };",
      'parent.config.mjs':
        "import './parent.mjs'; export default { projects: ['./project.config.mjs'] };",
      'parent.mjs': 'export default {};',
      'project.config.mjs': "export { default } from './shared.mjs';",
      'shared.mjs': "export default { name: 'watched' };",
    };
    for (const [file, content] of Object.entries(configs)) {
      fs.create(path.join(root, file), content);
    }

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '-c', 'root.config.mjs', '--project', 'watched'],
      options: { nodeOptions: { cwd: root } },
    });
    await cli.waitForStdout('Waiting for file changes...');

    for (const file of ['shared.mjs', 'parent.mjs', 'parent.config.mjs']) {
      cli.resetStd();
      fs.update(path.join(root, file), (content) => `${content}\n// changed`);
      await cli.waitForStdout(`restarting Rstest as ${file} changed`);
      await cli.waitForStdout('Tests 2 passed');
      await cli.waitForStdout('Waiting for file changes...');
    }
  });
});
