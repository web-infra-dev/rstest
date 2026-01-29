import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test list command', () => {
  it('should list tests correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
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
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
        "b.test.ts > test b > test b-1",
        "b.test.ts > test b-2",
        "c.test.ts > test c it each 0",
        "c.test.ts > test c it for 0",
        "c.test.ts > test c it runIf",
        "c.test.ts > test c it skipIf",
      ]
    `);
  });

  it('should list tests correctly with test shard', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--shard=1/2'],
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
        "Running shard 1 of 2 (2 of 3 tests)",
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
        "b.test.ts > test b > test b-1",
        "b.test.ts > test b-2",
      ]
    `);
  });

  it('should list tests correctly with file filter', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', 'a.test'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
      ]
    `);
  });

  it('should list tests correctly with test name filter', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '-t', 'a'],
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
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
        "c.test.ts > test c it each 0",
      ]
    `);
  });

  it('should list test files correctly with --filesOnly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--filesOnly'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);

    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts",
        "b.test.ts",
        "c.test.ts",
      ]
    `);
  });

  it('should list tests and suites correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--includeSuites'],
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
        "a.test.ts > test a",
        "a.test.ts > test a > test a-1",
        "a.test.ts > test a-2",
        "b.test.ts > test b",
        "b.test.ts > test b > test b-1",
        "b.test.ts > test b-2",
        "c.test.ts > test c describe each 0",
        "c.test.ts > test c describe for 0",
        "c.test.ts > test c describe runIf",
        "c.test.ts > test c describe skipIf",
        "c.test.ts > test c it each 0",
        "c.test.ts > test c it for 0",
        "c.test.ts > test c it runIf",
        "c.test.ts > test c it skipIf",
      ]
    `);
  });

  it('should list tests and suites with location correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--includeSuites', '--printLocation'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout?.split('\n').filter(Boolean);

    // rspack transpiles describe() to (0,rstest.describe)(), so the location is end of the callee
    // FIXME rspack trasnpiles describe.for to describe["for"] so the location is different from describe.each
    expect(logs).toMatchInlineSnapshot(`
      [
        "a.test.ts:3:9 > test a",
        "a.test.ts:4:5 > test a > test a-1",
        "a.test.ts:9:3 > test a-2",
        "b.test.ts:3:9 > test b",
        "b.test.ts:4:5 > test b > test b-1",
        "b.test.ts:9:3 > test b-2",
        "c.test.ts:3:1 > test c describe each 0",
        "c.test.ts:5:13 > test c describe for 0",
        "c.test.ts:7:1 > test c describe runIf",
        "c.test.ts:9:1 > test c describe skipIf",
        "c.test.ts:11:1 > test c it each 0",
        "c.test.ts:13:7 > test c it for 0",
        "c.test.ts:15:1 > test c it runIf",
        "c.test.ts:17:1 > test c it skipIf",
      ]
    `);
  });
});
