import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('onTestFailed', () => {
  it('onTestFailed should be called when test failed', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'onTestFailed.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);
    expect(cli.exec.process?.exitCode).toBe(1);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[afterEach] in level A",
        "[onTestFailed] it in level A",
      ]
    `);
  });
});
