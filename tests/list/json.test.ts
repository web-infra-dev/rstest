import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test list command with --json', () => {
  it('should list tests json correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--json'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "[",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/a.test.ts",",
        "    "name": "test a > test a-1"",
        "  },",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/a.test.ts",",
        "    "name": "test a-2"",
        "  },",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/b.test.ts",",
        "    "name": "test b > test b-1"",
        "  },",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/b.test.ts",",
        "    "name": "test b-2"",
        "  }",
        "]",
      ]
    `);
  });

  it('should list test files json correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly', '--json'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "[",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/a.test.ts"",
        "  },",
        "  {",
        "    "file": "<ROOT>/tests/list/fixtures/b.test.ts"",
        "  }",
        "]",
      ]
    `);
  });

  it('should output test json file correctly', async () => {
    const outputPath = join(__dirname, 'fixtures', 'output.json');

    fs.rmSync(outputPath, { force: true });

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--json', 'output.json'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    expect(fs.existsSync(outputPath)).toBeTruthy();

    fs.rmSync(outputPath, { force: true });
  });
});
