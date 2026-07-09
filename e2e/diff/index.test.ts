import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('diff', () => {
  it('should print diff info correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stderr
      .split('\n')
      .map((log) => log.replace(/\s/g, ''))
      .filter(Boolean);

    // should diff object correctly
    expect(logs.find((log) => log.includes('-"b":3,'))).toBeDefined();
    expect(logs.find((log) => log.includes('+"b":2,'))).toBeDefined();
    expect(logs.find((log) => log.includes('-"cA":3,'))).toBeDefined();
    expect(logs.find((log) => log.includes('+"cA":1,'))).toBeDefined();

    // should diff string correctly
    expect(logs.find((log) => log.includes('-hii'))).toBeDefined();
    expect(logs.find((log) => log.includes('+hi'))).toBeDefined();
  });
});
