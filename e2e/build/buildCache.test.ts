import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build cache config', () => {
  it('should enable build cache with rstest-aware dependencies and keep warm runs measurable', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures/buildCache');
    const cacheDir = join(fixtureDir, '.cache/build-cache-fixture');
    const cacheLocation = join(cacheDir, 'rstest-development');
    const outputDir = join(fixtureDir, 'dist/.rstest-temp');
    const inspectDir = join(outputDir, '.rsbuild');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });

    const runWithTiming = async () => {
      const start = Date.now();
      const result = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixtureDir,
            env: {
              DEBUG: 'rstest',
            },
          },
        },
      });

      await result.expectExecSuccess();
      return {
        durationMs: Date.now() - start,
        cli: result.cli,
      };
    };

    const coldRun = await runWithTiming();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const warmRun = await runWithTiming();
    const rsbuildConfigPath = join(inspectDir, 'rsbuild.config.mjs');

    expect(fs.existsSync(cacheLocation)).toBe(true);
    expect(fs.existsSync(rsbuildConfigPath)).toBe(true);

    const inspectedConfig = fs.readFileSync(rsbuildConfigPath, 'utf8');
    expect(inspectedConfig).toContain('buildCache');
    expect(inspectedConfig).toContain('.cache/build-cache-fixture');
    expect(inspectedConfig).toContain('fixture-digest');
    expect(inspectedConfig).toContain(
      '/e2e/build/fixtures/buildCache/extra-dependency.txt',
    );
    expect(inspectedConfig).toContain('rstest.config.mts');

    expect(coldRun.cli.stdout).toContain('config inspection completed');
    expect(warmRun.cli.stdout).toContain('config inspection completed');

    console.log(
      `buildCache timing: cold=${coldRun.durationMs}ms warm=${warmRun.durationMs}ms`,
    );
  });

  it('includes config dependencies in build cache', async () => {
    const root = join(
      __dirname,
      `fixtures-test-cache-dependencies-${process.env.RSTEST_OUTPUT_MODULE}`,
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures/buildCache'),
      fixturesTargetPath: root,
    });
    const configs = {
      'config.mjs': "export { default } from './root-dependency.mjs';",
      'root-dependency.mjs':
        "export default { projects: ['./project.config.mjs'] };",
      'project.config.mjs':
        "export { default } from './project-dependency.mjs';",
      'project-dependency.mjs':
        'export default { performance: { buildCache: true } };',
    };
    for (const [file, content] of Object.entries(configs)) {
      fixtureFs.create(join(root, file), content);
    }
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'config.mjs'],
      options: { nodeOptions: { cwd: root, env: { DEBUG: 'rstest' } } },
    });
    await expectExecSuccess();

    const inspected = fs.readFileSync(
      join(root, 'dist/.rstest-temp/.rsbuild/rsbuild.config.mjs'),
      'utf8',
    );
    for (const file of Object.keys(configs)) {
      expect(inspected).toContain(`/${file}`);
    }
  });

  it('should collect happy-dom build cache timing data on a non-trivial fixture', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures/happyDomBuildCache');
    const cacheDir = join(fixtureDir, '.cache/happy-dom-build-cache');

    fs.rmSync(cacheDir, { recursive: true, force: true });

    const runWithTiming = async () => {
      const start = Date.now();
      const result = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixtureDir,
          },
        },
      });

      await result.expectExecSuccess();
      return {
        durationMs: Date.now() - start,
      };
    };

    const coldRun = await runWithTiming();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const warmRun = await runWithTiming();

    expect(fs.existsSync(cacheDir)).toBe(true);

    console.log(
      `happy-dom buildCache timing: cold=${coldRun.durationMs}ms warm=${warmRun.durationMs}ms`,
    );
  });

  it('should keep virtual module mocks stable across cold and warm build cache runs', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures/mockBuildCache');
    const cacheDir = join(fixtureDir, '.cache/mock-build-cache');

    fs.rmSync(cacheDir, { recursive: true, force: true });

    const runFixture = async () => {
      const result = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixtureDir,
          },
        },
      });

      await result.expectExecSuccess();
      expect(result.cli.stdout).toContain('Tests 1 passed');
    };

    await runFixture();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(cacheDir)).toBe(true);

    await runFixture();
  });
});
