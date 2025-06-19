import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test externals', () => {
  it('should external node_modules by default', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', './fixtures/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);
  });
});
