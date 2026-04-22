import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test build cache config', () => {
  it('should enable build cache with rstest-aware dependencies and keep warm runs measurable', async ({
    onTestFinished,
  }) => {
    const fixtureName = 'buildCache';
    const cacheDir = join(__dirname, '.cache/build-cache-fixture');
    const outputDir = join(__dirname, 'dist/.rstest-temp');
    const inspectDir = join(outputDir, '.rsbuild');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });

    const runWithTiming = async () => {
      const start = Date.now();
      const result = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          `fixtures/${fixtureName}`,
          '-c',
          `fixtures/${fixtureName}/rstest.config.mts`,
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: __dirname,
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

    expect(fs.existsSync(cacheDir)).toBe(true);
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

  it('should collect happy-dom build cache timing data on a non-trivial fixture', async ({
    onTestFinished,
  }) => {
    const fixtureName = 'happyDomBuildCache';
    const cacheDir = join(__dirname, '.cache/happy-dom-build-cache');

    fs.rmSync(cacheDir, { recursive: true, force: true });

    const runWithTiming = async () => {
      const start = Date.now();
      const result = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          `fixtures/${fixtureName}`,
          '-c',
          `fixtures/${fixtureName}/rstest.config.mts`,
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: __dirname,
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
    const fixtureName = 'mockBuildCache';
    const cacheDir = join(__dirname, '.cache/mock-build-cache');

    fs.rmSync(cacheDir, { recursive: true, force: true });

    const runFixture = async () => {
      const result = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          `fixtures/${fixtureName}`,
          '-c',
          `fixtures/${fixtureName}/rstest.config.mts`,
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: __dirname,
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
