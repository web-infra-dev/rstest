import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('after hooks error', () => {
  it('should call other hooks correctly when afterAll error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'error/afterAll'],
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
        "[test] should run",
        "[afterEach] should run",
        "[afterAll - 0] should run",
      ]
    `);

    expect(
      cli.stderr
        .split('\n')
        .find((log) => log.includes('Error: afterAll error')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 1 passed'))).toBeTruthy();
  });

  it('should call other hooks correctly when afterEach error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'error/afterEach'],
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
        "[test] should run",
        "[afterEach - 0] should run",
        "[afterAll] should run",
      ]
    `);

    expect(
      cli.stderr
        .split('\n')
        .find((log) => log.includes('Error: afterEach error')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 1 failed'))).toBeTruthy();
  });
});
