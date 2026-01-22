import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects', () => {
  describe('merge configs', () => {
    it('should run projects correctly with cli options', async () => {
      const { cli, expectExecSuccess, expectLog } = await runRstestCli({
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

      // test project name print
      expectLog('[node]', logs);
      expectLog('[client-jsdom]', logs);
      // test log print
      expectLog('packages/node/test/index.test.ts', logs);
      expectLog('packages/client/test/App.test.tsx', logs);
      expectLog('packages/client/test/node.test.ts', logs);
    });

    it('should not inherit projects config and run projects failed ', async () => {
      const { expectExecFailed, expectStderrLog } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecFailed();
      // test log print
      expectStderrLog('it is not defined');
    }, 15_000);
  });

  it('should run project correctly with specified config root', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--globals', '-c', 'packages/client/rstest.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    // should only run client project
    expect(
      logs.find((log) => log.includes('packages/node/test/index.test.ts')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('packages/client/test/App.test.tsx')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('packages/client/test/node.test.ts')),
    ).toBeTruthy();
  });

  it('should run projects fail when project not found', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.404.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog(/Can't resolve project "404"/);
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
  it('should run projects with extends correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'extends'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.find((log) => log.includes('project-a'))).toBeTruthy();
    expect(logs.find((log) => log.includes('project-b'))).toBeTruthy();
  });
});
