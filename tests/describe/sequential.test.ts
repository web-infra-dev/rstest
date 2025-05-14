import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test sequential', () => {
  it('should run sequential suite cases correctly in concurrent suite', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/sequential.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.includes('[log]'))).toMatchInlineSnapshot(`
      [
        "[log] test",
        "[log] test 1",
        "[log] test 0 - 1",
        "[log] test 1 - 1",
        "[log] test 2",
        "[log] test 2 - 1",
        "[log] test 3",
        "[log] test 3 - 1",
        "[log] test 4",
        "[log] test 5",
        "[log] test 4 - 1",
        "[log] test 5 - 1",
      ]
    `);
  });
});
