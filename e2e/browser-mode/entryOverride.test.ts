import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - entry override', () => {
  it('should not execute user rsbuild entry (rstest controls entry)', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'entry-override'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).not.toContain('USER_ENTRY_SHOULD_NOT_RUN');
  });
});
