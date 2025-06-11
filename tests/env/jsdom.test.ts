import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('jsdom', () => {
  it('should run jsdom test correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/jsdom'),
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(0);
  });
});
