import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('console log', () => {
  it.for([
    ...['forks', 'threads', 'vmForks', 'vmThreads'].map((pool) => ({
      pool,
      silent: true,
      disableConsoleIntercept: false,
    })),
    { pool: 'forks', silent: true, disableConsoleIntercept: true },
    { pool: 'forks', silent: false, disableConsoleIntercept: false },
    { pool: 'forks', silent: 'passed-only', disableConsoleIntercept: false },
  ])(
    'formats only visible logs ($pool, silent=$silent, intercept disabled=$disableConsoleIntercept)',
    async ({ pool, silent, disableConsoleIntercept }, { onTestFinished }) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          'silent-formatting.test.ts',
          '--pool',
          pool,
          ...(silent === true
            ? ['--silent']
            : silent === 'passed-only'
              ? ['--silent=passed-only']
              : []),
          '--printConsoleTrace',
          ...(disableConsoleIntercept ? ['--disableConsoleIntercept'] : []),
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
            env: { RSTEST_EXPECT_SILENT: String(silent) },
          },
        },
      });
      await expectExecSuccess();
      if (silent === false) {
        expect(cli.log).toContain('formatted-console-value');
      } else {
        expect(cli.log).not.toContain('formatted-console-value');
      }
    },
  );

  it('should not console log when onConsoleLog return false', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'log.test', '-c', 'consoleLogFalse.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('I'))).toEqual([]);
  });

  it('should pass the stream type as the second onConsoleLog argument', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'log.test', '-c', 'consoleLogStderr.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    // stdout logs (console.log / console.info) are kept.
    expect(logs.some((log) => log.includes("I'm log"))).toBeTruthy();
    expect(logs.some((log) => log.includes("I'm info"))).toBeTruthy();
    // stderr logs (console.warn / console.error) are silenced via `type`.
    expect(logs.some((log) => log.includes("I'm warn"))).toBeFalsy();
    expect(logs.some((log) => log.includes("I'm error"))).toBeFalsy();
  });

  it('should onConsoleLog will not take effect when disableConsoleIntercept', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'log.test',
        '-c',
        'consoleLogFalse.config.ts',
        '--disableConsoleIntercept',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.some((log) => log.startsWith('I'))).toBeTruthy();
    expect(logs.some((log) => log.includes('log.test.ts:4:11'))).toBeFalsy();
  });

  it('should forward the native console in vmThreads when interception is disabled', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'log.test',
        '--pool',
        'vmThreads',
        '--pool.memoryLimit',
        '256MB',
        '--disableConsoleIntercept',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.some((log) => log.includes("I'm log"))).toBeTruthy();
    expect(logs.some((log) => log.includes("I'm info"))).toBeTruthy();
  });
});
