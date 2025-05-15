import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test list command', () => {
  it('should list tests correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
        "b.test.ts > test b > test b-1",
        "b.test.ts > test b-2",
      ]
    `);
  });

  it('should list tests correctly with file filter', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list', 'a.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
      ]
    `);
  });

  it('should list tests correctly with test name filter', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list', '-t', 'a'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
      ]
    `);
  });

  it('should list test files correctly with --filesOnly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts",
        "b.test.ts",
      ]
    `);
  });

  it('should list tests json correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--json'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "[",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/a.test.ts\\",",
        "    \\"name\\": \\"test a > test a-1\\"",
        "  },",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/a.test.ts\\",",
        "    \\"name\\": \\"test a-2\\"",
        "  },",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/b.test.ts\\",",
        "    \\"name\\": \\"test b > test b-1\\"",
        "  },",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/b.test.ts\\",",
        "    \\"name\\": \\"test b-2\\"",
        "  }",
        "]",
      ]
    `);
  });

  it('should list test files json correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly', '--json'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "[",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/a.test.ts\\"",
        "  },",
        "  {",
        "    \\"file\\": \\"<WORKSPACE>/tests/list/fixtures/b.test.ts\\"",
        "  }",
        "]",
      ]
    `);
  });
});
