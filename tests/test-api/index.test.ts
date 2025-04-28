import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test API', () => {
  it('test function undefined', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/undefined.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(
      logs.find((log) =>
        log.includes('Tests 1 failed | 1 passed | 1 skipped | 1 todo'),
      ),
    ).toBeTruthy();
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
            "[test] in level A",
            "[beforeEach] root",
            "[test] in level B-B",
            "[beforeEach] root",
            "[test] in level D",
          ]
        `);

    expect(
      logs.find((log) => log.includes('Test Files 1 passed')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Tests 3 passed | 3 skipped')),
    ).toBeTruthy();
  });

  it('should throw timeout error when test timeout', async () => {
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

    expect(
      logs.find((log) => log.includes('Error: test timed out in 50ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:5:5')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('Error: test timed out in 5000ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:10:5')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 failed'))).toBeTruthy();
  }, 10000);

  it('should not throw timeout error when update timeout time via testTimeout configuration', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'timeout.test', '--testTimeout=10000'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    // The timeout set by the API is higher than the global configuration item
    expect(
      logs.find((log) => log.includes('Error: test timed out in 50ms')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('timeout.test.ts:5:5')),
    ).toBeTruthy();

    expect(
      logs.find((log) => log.includes('Error: test timed out in 5000ms')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('Tests 1 failed | 1 passed')),
    ).toBeTruthy();
  }, 12000);
});
