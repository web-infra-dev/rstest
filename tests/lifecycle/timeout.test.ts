import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test timeout', () => {
  it('should throw timeout error when hook timeout', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'timeout.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[beforeAll] root",
      ]
    `);

    expect(
      logs.find((log) =>
        log.includes('Error: beforeAll hook timed out in 10ms'),
      ),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:4:1')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
  });
});
