import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - coverage', () => {
  it('should collect coverage data from browser tests with build cache enabled', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const cacheDir = join(fixtureDir, '.cache/browser-coverage');
    const coverageReportPath = join(fixtureDir, 'coverage/coverage-final.json');

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(join(fixtureDir, 'coverage'), { recursive: true, force: true });
    fs.rmSync(join(fixtureDir, 'dist'), { recursive: true, force: true });

    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage');

    await expectExecSuccess();

    // Verify coverage report is generated
    expect(cli.stdout).toMatch(/Coverage enabled with istanbul/);
    expect(fs.existsSync(cacheDir)).toBe(true);
    expect(fs.existsSync(coverageReportPath)).toBe(true);

    // sum.ts should have 100% coverage (tested)
    expect(cli.stdout.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');

    // multiply.ts should have 0% coverage (untested)
    expect(cli.stdout.replaceAll(' ', '')).toContain('multiply.ts|0|100|0|0');
  });

  it('should collect and merge coverage from browser + node multiproject', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.multiproject.config.mts'],
    });

    await expectExecSuccess();

    expect(cli.stdout).toMatch(/Coverage enabled with istanbul/);

    // sum.ts covered by browser project, multiply.ts covered by node project
    // Both should appear in the merged coverage report
    expect(cli.stdout.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'multiply.ts|100|100|100|100',
    );
  });

  it('should collect coverage data successfully without include option', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.noInclude.config.mts'],
    });

    await expectExecSuccess();

    // Verify coverage report is generated
    expect(cli.stdout).toMatch(/Coverage enabled with istanbul/);

    // sum.ts should have 100% coverage (tested)
    expect(cli.stdout.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');
  });

  it('should collect native V8 coverage from Chromium browser tests', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportPath = join(
      fixtureDir,
      'coverage-v8-browser/coverage-final.json',
    );

    fs.rmSync(join(fixtureDir, 'coverage-v8-browser'), {
      recursive: true,
      force: true,
    });

    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8BrowserCoverage.config.mts'],
    });

    await expectExecSuccess();

    expect(cli.stdout).toMatch(/Coverage enabled with v8/);
    expect(cli.stdout).toContain('malformed-source-map.test.ts');
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(cli.stdout.replaceAll(' ', '')).toContain('100%.ts|100|100|100|100');
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'cross-origin.ts|100|100|100|100',
    );
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'classic.ts|100|100|100|100',
    );
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'indexed.ts|100|100|100|100',
    );
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'query-a.ts|100|100|100|100',
    );
    expect(cli.stdout.replaceAll(' ', '')).toContain(
      'query-b.ts|100|100|100|100',
    );
    expect(cli.stdout.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');
    expect(cli.stdout.replaceAll(' ', '')).toContain('multiply.ts|0|100|0|0');
  });

  it('does not report virtual setup files in coverage', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportsDirectory = join(fixtureDir, 'coverage-virtual-setup');
    const reportPath = join(reportsDirectory, 'coverage-final.json');
    fs.rmSync(reportsDirectory, { recursive: true, force: true });

    const { expectExecSuccess } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.virtualSetup.config.mts'],
    });

    await expectExecSuccess();
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(
      Object.keys(report).some((file) => file.includes('.rstest-virtual')),
    ).toBe(false);
  });

  it('includes code executed by file fixture cleanup in V8 coverage', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportsDirectory = join(fixtureDir, 'coverage-v8-cleanup');
    const reportPath = join(reportsDirectory, 'coverage-final.json');
    fs.rmSync(reportsDirectory, { recursive: true, force: true });

    const { expectExecSuccess } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8Cleanup.config.mts'],
    });

    await expectExecSuccess();
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
      string,
      { s: Record<string, number> }
    >;
    const cleanupCoverage = Object.entries(report).find(([file]) =>
      file.replaceAll('\\', '/').endsWith('/src/cleanup.ts'),
    )?.[1];

    expect(cleanupCoverage).toBeDefined();
    expect(
      Object.values(cleanupCoverage?.s ?? {}).some((value) => value > 0),
    ).toBe(true);
  });

  it('includes code executed by file fixture cleanup in Istanbul coverage', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportsDirectory = join(fixtureDir, 'coverage-istanbul-cleanup');
    const reportPath = join(reportsDirectory, 'coverage-final.json');
    fs.rmSync(reportsDirectory, { recursive: true, force: true });

    const { expectExecSuccess } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.istanbulCleanup.config.mts'],
    });

    await expectExecSuccess();
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
      string,
      { s: Record<string, number> }
    >;
    const cleanupCoverage = Object.entries(report).find(([file]) =>
      file.replaceAll('\\', '/').endsWith('/src/cleanup.ts'),
    )?.[1];

    expect(cleanupCoverage).toBeDefined();
    expect(
      Object.values(cleanupCoverage?.s ?? {}).some((value) => value > 0),
    ).toBe(true);
  });

  it('preserves V8 coverage from concurrent pages when one fails fatally', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportsDirectory = join(fixtureDir, 'coverage-v8-concurrent-failure');
    const reportPath = join(reportsDirectory, 'coverage-final.json');
    fs.rmSync(reportsDirectory, { recursive: true, force: true });

    const { expectExecFailed } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8ConcurrentFailure.config.mts'],
    });

    await expectExecFailed();
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
      string,
      { s: Record<string, number> }
    >;
    const concurrentCoverage = Object.entries(report).find(([file]) =>
      file.replaceAll('\\', '/').endsWith('/src/concurrent.ts'),
    )?.[1];

    expect(concurrentCoverage).toBeDefined();
    expect(Object.values(concurrentCoverage?.s ?? {})).toContain(1);
  });

  it('uses normalized V8 source maps for failure stacks and reports', async () => {
    const fixtureDir = join(__dirname, 'fixtures/browser-coverage');
    const reportsDirectory = join(fixtureDir, 'coverage-v8-mapped-error');
    const reportPath = join(reportsDirectory, 'coverage-final.json');
    fs.rmSync(reportsDirectory, { recursive: true, force: true });

    const { expectExecFailed, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8MappedError.config.mts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`.replaceAll('\\', '/')).toContain(
      'maps/sources/mapped-error.ts',
    );
    expect(`${cli.stdout}\n${cli.stderr}`.replaceAll('\\', '/')).toContain(
      'maps/sources/query-mapped-error.ts',
    );

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const reportedFiles = Object.keys(report).map((file) =>
      file.replaceAll('\\', '/'),
    );
    for (const virtualSource of [
      'webpack/runtime',
      'webpack://',
      'rstest runtime',
      'data:text',
      'blob:http',
    ]) {
      expect(reportedFiles.some((file) => file.includes(virtualSource))).toBe(
        false,
      );
    }
  });
});
