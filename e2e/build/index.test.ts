import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build config', () => {
  it.concurrent.for([
    { name: 'define' },
    { name: 'alias' },
    { name: 'plugin' },
    { name: 'modifyRstestConfig' },
    { name: 'tools/rspack' },
    { name: 'decorators' },
  ])(
    '$name config should work correctly',
    async ({ name }, { onTestFinished }) => {
      // Run each fixture inside its own directory so the default output path
      // (dist/.rstest-temp) is scoped to that fixture and never collides with
      // sibling test files that also spawn rstest under e2e/build/.
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures', name),
          },
        },
      });

      await expectExecSuccess();
    },
  );

  it('modifyRstestConfig should apply before listing test files', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('project-a.test.ts');
    expect(cli.stdout).toContain('project-b.test.ts');
    expect(cli.stdout).toContain('return-project.test.ts');
    expect(cli.stdout).not.toContain('ignored.test.ts');
  });

  it('modifyRstestConfig should apply when initial node test entries are empty', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.noInitialTests.config.mts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('uses project-a modified config');
    expect(cli.stdout).not.toContain('No test files found');
  });

  it('modifyRstestConfig should refresh run plan before dependency checks', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.environment.config.mts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('uses modified jsdom environment');
    expect(cli.stdout).not.toContain('No test files found');
  });

  it('modifyRstestConfig should refresh run plan when tests are removed', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.emptyAfterModify.config.mts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('No test files found');
    expect(cli.stdout).not.toContain('uses project-a modified config');
  });

  it('modifyRstestConfig should preserve shard partition', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.shard.config.mts', '--shard', '1/2'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    expect(cli.stdout).toContain('Running shard 1 of 2 (2 of 3 test files)');
    expect(cli.stdout).toContain('shard-a.test.ts');
    expect(cli.stdout).toContain('shard-b.test.ts');
    expect(cli.stdout).not.toContain('shard-c.test.ts');
  });

  it('modifyRstestConfig should print final shard count when listing test files', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'list',
        '--filesOnly',
        '--config',
        'rstest.listShard.config.mts',
        '--shard',
        '1/2',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/modifyRstestConfig'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);
    expect(logs).toEqual([
      'Running shard 1 of 2 (2 of 3 test files)',
      'shard-a.test.ts',
      'shard-b.test.ts',
    ]);
  });

  it('should write output to customized distPath.root', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures/customOutput');
    const defaultOutputPath = join(fixtureDir, 'dist/.rstest-temp');
    const customOutputPath = join(fixtureDir, 'custom/.rstest-temp');

    fs.rmSync(defaultOutputPath, { recursive: true, force: true });
    fs.rmSync(join(fixtureDir, 'custom'), {
      recursive: true,
      force: true,
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecSuccess();

    expect(fs.existsSync(join(customOutputPath, 'rstest-manifest.json'))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        join(
          customOutputPath,
          process.env.RSTEST_OUTPUT_MODULE === 'false'
            ? 'rstest-runtime.js'
            : 'rstest-runtime.mjs',
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(join(defaultOutputPath, 'rstest-manifest.json'))).toBe(
      false,
    );
  });
});
