import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('console trace', () => {
  it('should console log trace when printConsoleTrace enabled', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'log.test', '--printConsoleTrace'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    const errLogs = cli.stderr.split('\n').filter(Boolean);

    expect(errLogs.filter((log) => log.startsWith('I'))).toMatchInlineSnapshot(`
      [
        "I'm warn",
        "I'm error",
      ]
    `);

    expect(logs.filter((log) => log.startsWith('I'))).toMatchInlineSnapshot(`
      [
        "I'm log",
        "I'm info",
      ]
    `);
    expect(logs.some((log) => log.includes('log.test.ts:4:11'))).toBeTruthy();
  });

  it('should console log trace correctly in src', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'logSrc.test', '--printConsoleTrace'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('I'))).toMatchInlineSnapshot(`
      [
        "I'm src log",
      ]
    `);

    expect(logs.some((log) => log.includes('index.ts:1'))).toBeTruthy();
  });

  it('should console trace correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stderr.split('\n').filter(Boolean);

    expect(logs.some((log) => log.includes('trace.test.ts:4:11'))).toBeTruthy();
  });

  it('should print the call site of console.table and console.trace', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'callSite.test', '--printConsoleTrace'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const titles = [
      ...cli.stdout.split('\n'),
      ...cli.stderr.split('\n'),
    ].filter((log) => log.includes(' | callSite.test.ts > '));

    expect(titles).toEqual([
      'log | callSite.test.ts > prints call sites | callSite.test.ts:4:11',
      'error | callSite.test.ts > prints call sites | callSite.test.ts:5:11',
    ]);
  });
});
