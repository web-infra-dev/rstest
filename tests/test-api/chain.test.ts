import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test Chain', () => {
  it('chain API enumerable', async () => {
    expect(Object.keys(it)).toMatchInlineSnapshot(`
      [
        "fails",
        "concurrent",
        "skip",
        "todo",
        "only",
        "runIf",
        "skipIf",
        "each",
        "for",
      ]
    `);
    expect(Object.keys(it.only)).toMatchInlineSnapshot(`
      [
        "fails",
        "concurrent",
        "skip",
        "todo",
        "only",
        "runIf",
        "skipIf",
        "each",
        "for",
      ]
    `);
  });

  it('Support only.each', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/only.each.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);
    expect(
      logs.find((log) => log.includes('Tests 3 passed | 1 skipped')),
    ).toBeTruthy();
  });

  it('Support only.fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/only.fails.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);
    expect(
      logs.find((log) => log.includes('Tests 1 passed | 1 skipped')),
    ).toBeTruthy();
  });
});
