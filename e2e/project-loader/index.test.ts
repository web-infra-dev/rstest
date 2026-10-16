import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, 'fixtures');

const run = (config: string) =>
  runRstestCli({
    command: 'rstest',
    args: ['run', '-c', config],
    options: { nodeOptions: { cwd: fixturesPath } },
  });

describe('PROJECT_LOADER', () => {
  describe("projects: ['packages/*']", () => {
    it('loads each package config through the loader', async () => {
      const { cli, expectExecSuccess, expectLog } = await run(
        'rstest.dir.config.mts',
      );
      await expectExecSuccess();

      expectLog('[project-loader] {"dirPath":"packages/pkg-a"}');
      expectLog('[project-loader] {"dirPath":"packages/pkg-b"}');
      // `name` comes from each package config; `include` skips the throwing
      // files; `globals` differs per package (asserted inside the tests).
      expectLog(/✓ \[custom-a\] packages\/pkg-a\/tests\/a\.test\.ts/);
      expectLog(/✓ \[custom-b\] packages\/pkg-b\/src\/b\.spec\.ts/);
      expect(cli.stdout).toContain('Tests 2 passed');
      expect(cli.stdout).not.toContain('outside.test.ts');
      expect(cli.stdout).not.toContain('b.test.ts');
    });
  });

  describe("projects: ['packages/*/custom.config.mts']", () => {
    it('loads the given file through the loader', async () => {
      const { cli, expectExecSuccess, expectLog } = await run(
        'rstest.file.config.mts',
      );
      await expectExecSuccess();

      expectLog(
        '[project-loader] {"dirPath":"packages/pkg-a","filePath":"packages/pkg-a/custom.config.mts"}',
      );
      expectLog(
        '[project-loader] {"dirPath":"packages/pkg-b","filePath":"packages/pkg-b/custom.config.mts"}',
      );
      expectLog(/✓ \[custom-a\]/);
      expectLog(/✓ \[custom-b\]/);
      expect(cli.stdout).toContain('Tests 2 passed');
    });
  });

  it('restarts watch when a loader-provided config file changes', async () => {
    const fixturesTargetPath = `${fixturesPath}-test-watch${process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''}`;
    const { fs } = await prepareFixtures({ fixturesPath, fixturesTargetPath });
    const configFile = join(
      fixturesTargetPath,
      'packages/pkg-a/custom.config.mts',
    );

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '-c', 'rstest.dir.config.mts'],
      options: { nodeOptions: { cwd: fixturesTargetPath } },
    });
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('[custom-a]');

    cli.resetStd();
    fs.update(configFile, (content) =>
      content.replace("name: 'custom-a'", "name: 'custom-a-renamed'"),
    );

    await cli.waitForStdout(
      'restarting Rstest as packages/pkg-a/custom.config.mts changed',
    );
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('[custom-a-renamed]');
    expect(cli.stdout).toContain('Tests 2 passed');

    cli.exec.kill();
  });
});
