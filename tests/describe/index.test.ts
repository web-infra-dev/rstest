import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test describe API', () => {
  it('should skip test when describe skipped', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'skip.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(
      logs.find((log) => log.includes('Test Files 1 skipped')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 skipped'))).toBeTruthy();
  });

  it('should skip test when describe todo', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'todo.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(logs.find((log) => log.includes('Test Files 1 todo'))).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 todo'))).toBeTruthy();
  });

  it('should allow skip / todo function undefined', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'undefined.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(
      logs.find((log) => log.includes('Test Files 1 skipped')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeTruthy();
  });

  it('test only', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/only.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[beforeEach] root",
        "[test] in level B-A",
        "[beforeEach] root",
        "[test] in level B-C-A",
        "[beforeEach] root",
        "[test] in level E-A",
      ]
    `);

    expect(
      logs.find((log) => log.includes('Test Files 1 passed')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Tests 3 passed | 4 skipped')),
    ).toBeTruthy();
  });
});
