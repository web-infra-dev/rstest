import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('before hooks error', () => {
  it('should call other hooks correctly when beforeAll error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'error/beforeAll.test'],
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
        "[beforeAll - 0] should run",
        "[afterAll] should run",
      ]
    `);

    expect(
      cli.stderr
        .split('\n')
        .find((log) => log.includes('Error: beforeAll error')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 1 skipped'))).toBeTruthy();
  });

  it('should call other hooks correctly when root beforeAll error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'error/beforeAllRoot.test'],
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
        "[afterAll] should run root",
      ]
    `);

    expect(
      cli.stderr
        .split('\n')
        .find((log) => log.includes('Error: beforeAll error')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 skipped'))).toBeTruthy();
  });

  it('should call other hooks correctly when beforeEach error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'error/beforeEach'],
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
        "[beforeAll] should run",
        "[beforeEach - 0] should run",
        "[afterEach] should run",
        "[afterAll] should run",
      ]
    `);

    expect(
      cli.stderr
        .split('\n')
        .find((log) => log.includes('Error: beforeEach error')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 1 failed'))).toBeTruthy();
  });
});
