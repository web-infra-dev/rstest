import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects', () => {
  describe('merge configs', () => {
    it('should run projects correctly with cli options', async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--globals'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecSuccess();
      const logs = cli.stdout.split('\n').filter(Boolean);

      // test log print
      expect(
        logs.find((log) => log.includes('packages/node/test/index.test.ts')),
      ).toBeTruthy();
      expect(
        logs.find((log) => log.includes('packages/client/test/App.test.tsx')),
      ).toBeTruthy();
      expect(
        logs.find((log) => log.includes('packages/client/test/node.test.ts')),
      ).toBeTruthy();
    });

    it('should not inherit projects config and run projects failed ', async () => {
      const { cli, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecFailed();
      const logs = cli.stdout.split('\n').filter(Boolean);

      // test log print
      expect(
        logs.find((log) => log.includes('it is not defined')),
      ).toBeTruthy();
    }, 15_000);
  });

  it('should run projects fail when project not found', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.404.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    expect(
      logs.find((log) => log.includes(`Can't resolve project "404"`)),
    ).toBeTruthy();
  });

  it('should run test failed when test file not found', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '404-file', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    expect(
      logs.find((log) => log.includes('No test files found')),
    ).toBeTruthy();
  });

  it('should run test success when test file not found with passWithNoTests flag', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '404-file', '--passWithNoTests', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    expect(
      logs.find((log) => log.includes('No test files found')),
    ).toBeTruthy();
  });
});
