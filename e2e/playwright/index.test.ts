import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('@rstest/playwright', () => {
  it('runs with Playwright fixtures and assertions', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts', 'debug.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_E2E_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_DEBUG_OFF');
    expect(cli.stdout).toContain('Test Files 2 passed');
  });

  it(
    'can opt into headed debug mode from a test',
    { timeout: 60_000 },
    async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', 'debug.test.ts'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
            env: {
              RSTEST_PLAYWRIGHT_E2E_DEBUG: 'true',
            },
          },
        },
      });

      await expectExecSuccess();
      expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_DEBUG_ON');
    },
  );
});
