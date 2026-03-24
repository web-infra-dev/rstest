import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - config options', () => {
  it('should work with global config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('config');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should respect customized output.distPath.root', async () => {
    const fixtureDir = join(__dirname, 'fixtures/custom-output');
    const customOutputPath = join(fixtureDir, 'custom/.rstest-temp');
    const defaultOutputPath = join(fixtureDir, 'dist/.rstest-temp');

    fs.rmSync(customOutputPath, { recursive: true, force: true });
    fs.rmSync(defaultOutputPath, { recursive: true, force: true });

    const { expectExecSuccess, cli } = await runBrowserCli('custom-output');
    await expectExecSuccess();

    expect(cli.stdout).toMatch(/Tests.*passed/);
    expect(fs.existsSync(customOutputPath)).toBe(true);
    expect(fs.existsSync(defaultOutputPath)).toBe(false);
  });

  it('should fail early when browser provider is invalid', async () => {
    const { expectExecFailed, expectStderrLog, cli } =
      await runBrowserCli('invalid-provider');

    await expectExecFailed();
    expectStderrLog(/browser\.provider must be one of: playwright\./);
    expect(cli.stdout).not.toMatch(/Browser mode opened at/);
  });

  it('should fail early when bundleDependencies is false in browser mode', async () => {
    const { expectExecFailed, expectStderrLog, cli } = await runBrowserCli(
      'invalid-bundle-dependencies',
    );

    await expectExecFailed();
    expectStderrLog(
      /output\.bundleDependencies false is not supported in browser mode\./,
    );
    expect(cli.stdout).not.toMatch(/Browser mode opened at/);
  });
});
