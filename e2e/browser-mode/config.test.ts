import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { runBrowserCli } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - config options', () => {
  it('should work with browser.enabled config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('config', {
      args: ['index.test.ts'],
    });

    await expectExecSuccess();
    console.log('😿', cli.stdout);
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  // it('should work with globals: true config', async () => {
  //   const { expectExecSuccess, cli } = await runBrowserCli('config');

  //   await expectExecSuccess();
  //   // Test uses globals (describe, it, expect without import)
  //   expect(cli.stdout).toMatch(/globals config/);
  // });

  // it('should work with --browser CLI flag', async () => {
  //   // Use basic fixture but without browser.enabled in config
  //   const { expectExecSuccess, cli } = await runRstestCli({
  //     command: 'rstest',
  //     args: ['run', '--browser', 'tests/dom.test.ts'],
  //     options: {
  //       nodeOptions: {
  //         cwd: join(__dirname, 'fixtures/basic'),
  //       },
  //     },
  //   });

  //   await expectExecSuccess();
  //   expect(cli.stdout).toMatch(/Tests.*passed/);
  // });

  // it('should respect testTimeout config', async () => {
  //   const { expectExecFailed, cli } = await runBrowserCli('error', {
  //     args: ['tests/timeout-error.test.ts'],
  //   });

  //   await expectExecFailed();
  //   // Test should fail due to timeout
  //   expect(cli.stdout).toMatch(/fail|timeout/i);
  // });
});
