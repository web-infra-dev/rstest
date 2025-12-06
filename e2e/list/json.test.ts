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
        "    "file": "<ROOT>/e2e/list/fixtures/a.test.ts",",
        "    "name": "test a",",
        "    "location": {",
        "      "line": 3,",
        "      "column": 9",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/a.test.ts",",
        "    "name": "test a > test a-1",",
        "    "location": {",
        "      "line": 4,",
        "      "column": 5",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/a.test.ts",",
        "    "name": "test a-2",",
        "    "location": {",
        "      "line": 9,",
        "      "column": 3",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/b.test.ts",",
        "    "name": "test b",",
        "    "location": {",
        "      "line": 3,",
        "      "column": 9",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/b.test.ts",",
        "    "name": "test b > test b-1",",
        "    "location": {",
        "      "line": 4,",
        "      "column": 5",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/b.test.ts",",
        "    "name": "test b-2",",
        "    "location": {",
        "      "line": 9,",
        "      "column": 3",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c describe each 0",",
        "    "location": {",
        "      "line": 3,",
        "      "column": 1",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c describe for 0",",
        "    "location": {",
        "      "line": 5,",
        "      "column": 13",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c describe runIf",",
        "    "location": {",
        "      "line": 7,",
        "      "column": 1",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c describe skipIf",",
        "    "location": {",
        "      "line": 9,",
        "      "column": 1",
        "    },",
        "    "type": "suite"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c it each 0",",
        "    "location": {",
        "      "line": 11,",
        "      "column": 1",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c it for 0",",
        "    "location": {",
        "      "line": 13,",
        "      "column": 7",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c it runIf",",
        "    "location": {",
        "      "line": 15,",
        "      "column": 1",
        "    },",
        "    "type": "case"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "name": "test c it skipIf",",
        "    "location": {",
        "      "line": 17,",
        "      "column": 1",
        "    },",
        "    "type": "case"",
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
        "    "file": "<ROOT>/e2e/list/fixtures/a.test.ts",",
        "    "type": "file"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/b.test.ts",",
        "    "type": "file"",
        "  },",
        "  {",
        "    "file": "<ROOT>/e2e/list/fixtures/c.test.ts",",
        "    "type": "file"",
        "  }",
        "]",
      ]
    `);
  });

  it('should output test json file correctly', async () => {
    const outputPath = join(__dirname, 'fixtures', 'output.json');

    fs.rmSync(outputPath, { force: true });

    const { expectExecSuccess } = await runRstestCli({
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
