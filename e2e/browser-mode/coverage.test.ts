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
});
