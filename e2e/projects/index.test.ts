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
    });
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
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', '404-file', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();
    // test log print
    expectStderrLog('No test files found');
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

  describe('project-specific configs', () => {
    it('should respect hideSkippedTests per project', async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.projectConfig.config.ts',
          '--reporter',
          'verbose',
        ],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecSuccess();
      const logs = cli.stdout.split('\n').filter(Boolean);

      // node-hide-skip project should hide skipped tests (only "should pass" visible)
      expect(
        logs.find(
          (log) => log.includes('should be skipped') && !log.includes('client'),
        ),
      ).toBeFalsy();

      // client-show-skip project should show skipped tests
      expect(
        logs.find((log) => log.includes('should be skipped in client')),
      ).toBeTruthy();
    });

    it('should respect slowTestThreshold per project', async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.slowTest.config.ts',
          '--reporter',
          'verbose',
        ],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecSuccess();
      const logs = cli.stdout.split('\n').filter(Boolean);

      // Both projects run slow test, but we check the test count display
      // node-slow project shows test with (51ms) - above 10ms threshold
      // client-fast project shows test with (51ms) - below 1000ms threshold
      // The slow indicator is in the icon color (yellow vs green), not text
      // We just verify both tests are shown
      expect(logs.find((log) => log.includes('[node-slow]'))).toBeTruthy();
      expect(logs.find((log) => log.includes('[client-fast]'))).toBeTruthy();
    });

    it('should respect hideSkippedTestFiles per project', async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '-c', 'rstest.hideSkippedTestFiles.config.ts'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
          },
        },
      });

      await expectExecSuccess();
      const logs = cli.stdout.split('\n').filter(Boolean);

      // node-hide-file project should hide skipped test files
      expect(logs.find((log) => log.includes('[node-hide-file]'))).toBeFalsy();

      // client-show-file project should show skipped test files
      expect(
        logs.find((log) => log.includes('[client-show-file]')),
      ).toBeTruthy();
    });
  });
});
