import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { BROWSER_PORTS } from './fixtures/ports';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - no tests', () => {
  it('should exit with code 1 by default when no tests found', async () => {
    const { cli, expectExecFailed } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'no-tests'),
    );

    await expectExecFailed();
    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
  });

  it('should exit with code 0 when passWithNoTests flag is enabled', async () => {
    const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'no-tests'),
      { args: ['--passWithNoTests'] },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('No test files found, exiting with code 0.');
  });

  it('should list an empty browser project without starting its server', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(BROWSER_PORTS['no-tests'], '127.0.0.1', resolve);
    });

    try {
      const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
        join(__dirname, 'fixtures', 'no-tests'),
        { command: 'list', args: ['--filesOnly'] },
      );

      await expectExecSuccess();
      expect(cli.stdout).not.toContain('.test.ts');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
