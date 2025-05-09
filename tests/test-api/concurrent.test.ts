import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test Concurrent', () => {
  it('should run concurrent cases correctly', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/concurrent.test.ts'],
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
        "[log] serial test",
        "[log] serial test 0 - 1",
        "[log] concurrent test 1",
        "[log] concurrent test 2",
        "[log] concurrent test 2 - 1",
        "[log] concurrent test 1 - 1",
        "[log] concurrent test 3",
        "[log] concurrent test 3 - 1",
        "[log] concurrent test B 1",
        "[log] concurrent test B 1 - 1",
        "[log] serial test B 1",
        "[log] concurrent test B 2",
        "[log] concurrent test B 2 - 1",
      ]
    `);
  });

  it('should run concurrent cases correctly with nested', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/concurrentNested.test.ts'],
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
        "[log] serial test",
        "[log] serial test 0 - 1",
        "[log] concurrent test 1",
        "[log] concurrent test 2",
        "[log] concurrent test 2 - 1",
        "[log] concurrent test 1 - 1",
        "[log] concurrent test 3",
        "[log] concurrent test 4",
        "[log] concurrent test 3 - 1",
        "[log] concurrent test 4 - 1",
        "[log] concurrent test 5",
        "[log] concurrent test 5 - 1",
      ]
    `);
  });

  it('should run concurrent cases isolated in different suites', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/concurrentIsolated.test.ts'],
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
        "[log] concurrent test 1",
        "[log] concurrent test 2",
        "[log] concurrent test 2 - 1",
        "[log] concurrent test 1 - 1",
        "[log] concurrent test B 1",
        "[log] concurrent test B 2",
        "[log] concurrent test B 2 - 1",
        "[log] concurrent test B 1 - 1",
      ]
    `);
  });

  it('should run concurrent cases correctly with limit', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/concurrentLimit.test.ts'],
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
        "[log] concurrent test 1",
        "[log] concurrent test 2",
        "[log] concurrent test 3",
        "[log] concurrent test 4",
        "[log] concurrent test 5",
        "[log] concurrent test 2 - 1",
        "[log] concurrent test 6",
        "[log] concurrent test 3 - 1",
        "[log] concurrent test 7",
        "[log] concurrent test 4 - 1",
        "[log] concurrent test 5 - 1",
        "[log] concurrent test 1 - 1",
        "[log] concurrent test 6 - 1",
        "[log] concurrent test 7 - 1",
      ]
    `);
  });
});
