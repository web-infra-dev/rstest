import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('no tests', () => {
  it.for([false, true])(
    'reports missing files with passWithNoTests=%s',
    async (passWithNoTests) => {
      const { cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          'missing.test.ts',
          `--passWithNoTests=${passWithNoTests}`,
        ],
        stripAnsi: false,
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures-no-match'),
            env: { FORCE_COLOR: '1', NO_COLOR: '' },
          },
        },
      });

      await cli.exec;
      await cli.waitForStreamsEnd();

      expect(cli.exec.process?.exitCode).toBe(passWithNoTests ? 0 : 1);
      if (passWithNoTests) {
        expect(cli.stdout.split(/\r?\n/)).toContain(
          'No test files found, exiting with code 0.',
        );
        expect(cli.stderr).not.toContain('No test files found');
      } else {
        expect(cli.stderr).toContain(
          'No test files found, exiting with code 1.',
        );
      }
      for (const detail of ['root:', 'include:', 'exclude:', 'filter:']) {
        if (passWithNoTests) {
          expect(cli.log).not.toContain(detail);
        } else {
          expect(cli.log).toContain(detail);
        }
      }
    },
  );

  it('should error when no tests', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 3 failed')),
    ).toBeDefined();
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeDefined();
    expect(cli.log).not.toContain('[empty-suite-hook]');
  });

  it('should passWithNoTests with passWithNoTests flag', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/', '--passWithNoTests'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 3 passed')),
    ).toBeDefined();
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeDefined();
    expect(cli.log).not.toContain('[empty-suite-hook]');
  });

  it('should not check coverage provider when no tests match', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '--coverage.provider',
        'istanbul',
        '--passWithNoTests',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures-no-match'),
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(0);
    expect(cli.log).toContain('No test files found, exiting with code 0.');
    expect(cli.log).not.toContain('Failed to load coverage provider module');
    expect(cli.log).not.toContain('@rstest/coverage-istanbul is required');
  });
});
