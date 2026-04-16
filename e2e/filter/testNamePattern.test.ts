import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test testNamePattern', () => {
  it('should filter test case name success', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testNamePattern.test.ts', '-t=level-B-A'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[test] in level-B-A",
      ]
    `);
  });

  it('should filter test suite name success', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testNamePattern.test.ts', '-t=level-B'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[test] in level-B-A",
        "[test] in level-B-C-A",
      ]
    `);
  });

  it('should filter test full name success', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/testNamePattern.test.ts',
        '-t',
        'level-A > level-B > it in level-B-A',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[test] in level-B-A",
      ]
    `);
  });

  it('should filter test with suite name success', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/testNamePattern.test.ts',
        '-t',
        'level-B it in level-B-A',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(`
      [
        "[test] in level-B-A",
      ]
    `);
  });

  it('should not run tests when filter test skipped', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testNamePattern.test.ts', '-t=level-B-B'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toMatchInlineSnapshot(
      '[]',
    );
  });
});
