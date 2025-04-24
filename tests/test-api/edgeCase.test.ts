import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test Edge Cases', () => {
  it('no unexpected rpc error about result.expected', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/error.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.find((log) => log.includes('Error: Symbol('))).toBeFalsy();
  });

  it('test module not found', async () => {
    // Module not found errors should be silent at build time, and throw errors at runtime
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/moduleNotFound.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);
    expect(logs.find((log) => log.includes('Build error'))).toBeFalsy();
    expect(logs.find((log) => log.includes('Module not found'))).toBeFalsy();
    expect(logs.find((log) => log.includes('Tests 2 passed'))).toBeTruthy();
  });
});
