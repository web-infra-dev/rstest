import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test ssr', () => {
  it('should run ssr test succeed', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'test/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(cli.exec.process?.exitCode).toBe(0);
  });
});
