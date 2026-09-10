import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('globalSetup', async () => {
  describe.skipIf(process.platform === 'win32')('SIGINT cancellation', () => {
    it.for(
      ['forks', 'threads', 'vmForks', 'vmThreads'].flatMap((pool) => [
        { pool, phase: 'test', exitDuringCleanup: false },
        { pool, phase: 'test', exitDuringCleanup: true },
        { pool, phase: 'run-start', exitDuringCleanup: false },
        { pool, phase: 'run-end', exitDuringCleanup: false },
        { pool, phase: 'global-setup', exitDuringCleanup: false },
      ]),
    )(
      'cancels $phase under $pool (cleanup calls exit: $exitDuringCleanup)',
      async ({ pool, phase, exitDuringCleanup }) => {
        const fixturesTargetPath = join(
          __dirname,
          `fixtures-test-sigint-${pool}-${phase}-${exitDuringCleanup}`,
        );
        const { fs } = await prepareFixtures({
          fixturesPath: join(__dirname, 'fixtures/basic'),
          fixturesTargetPath,
        });
        fs.update(join(fixturesTargetPath, 'rstest.config.ts'), (content) =>
          content.replace(
            'globalSetup:',
            `reporters: ['blob', 'default', {
            onTestFileResult() { console.log('[unexpected-file-result]'); },
            async onTestRunStart() {
              if ('${phase}' === 'run-start') {
                await new Promise(resolve => {
                  process.once('SIGINT', resolve);
                  console.log('[run-start]');
                });
              } else console.log('[run-start]');
            },
            async onTestRunEnd() {
              if ('${phase}' === 'run-end') {
                await new Promise(resolve => {
                  process.once('SIGINT', resolve);
                  console.log('[run-end-pending]');
                });
              }
              await new Promise(resolve => setTimeout(resolve, 100));
              console.log('[run-end]');
            },
          }], globalSetup:`,
          ),
        );
        if (phase === 'global-setup') {
          fs.update(
            join(fixturesTargetPath, 'setups/defaultExport.ts'),
            (content) =>
              content.replace(
                "  console.log('[global-setup-default] executed');",
                `  console.log('[setup-pending]');
                 const { existsSync } = await import('node:fs');
                 while (!existsSync('release-setup')) {
                   await new Promise(resolve => setTimeout(resolve, 10));
                 }
                 console.log('[setup-finished]');
                 console.log('[global-setup-default] executed');`,
              ),
          );
        }
        if (exitDuringCleanup) {
          fs.update(join(fixturesTargetPath, 'rstest.config.ts'), (content) =>
            content.replace(
              "console.log('[rstest-dev-server] closed');",
              "console.log('[rstest-dev-server] closed'); process.exit(0);",
            ),
          );
        }
        for (const name of ['index.test.ts', 'index1.test.ts']) {
          fs.update(
            join(fixturesTargetPath, name),
            () => `
            import { test } from '@rstest/core';
            test('wait for cancellation', async () => {
              console.log('[test-running]');
              if ('${phase}' !== 'run-end') {
                await new Promise(resolve => setTimeout(resolve, '${phase}' === 'run-start' ? 100 : 60000));
              }
            }, 65000);
          `,
          );
        }
        const { cli, expectExecFailed } = await runRstestCli({
          command: 'rstest',
          args: [
            'run',
            '--pool',
            pool,
            '--pool.maxWorkers',
            '1',
            '--disableConsoleIntercept',
            '--trace',
            ...(phase === 'run-end'
              ? [
                  '--coverage',
                  '--coverage.provider',
                  'v8',
                  '--coverage.reporter',
                  'json',
                ]
              : []),
          ],
          options: {
            nodeOptions: {
              cwd: fixturesTargetPath,
              env: { ISOLATE: undefined },
            },
          },
        });
        try {
          await cli.waitForStdout(
            phase === 'run-start'
              ? '[run-start]'
              : phase === 'run-end'
                ? '[run-end-pending]'
                : phase === 'global-setup'
                  ? '[setup-pending]'
                  : '[test-running]',
          );
          cli.exec.process!.kill('SIGINT');
          if (phase === 'global-setup') {
            await cli.waitForStdout('Received SIGINT');
            fs.create(join(fixturesTargetPath, 'release-setup'), '');
          }
          await expectExecFailed();
          expect(cli.exec.process!.exitCode).toBe(130);
          if (phase !== 'run-end')
            expect(cli.log).not.toContain('[unexpected-file-result]');
          expect(cli.stdout.match(/\[run-start\]/g)).toHaveLength(1);
          expect(
            existsSync(join(fixturesTargetPath, '.rstest-reports/blob.json')),
          ).toBe(false);
          if (exitDuringCleanup) return;
          expect(cli.stdout.match(/\[run-end\]/g)).toHaveLength(1);
          expect(cli.log).not.toContain('No test files found');
          if (phase === 'run-start' || phase === 'global-setup')
            expect(cli.log).not.toContain('[test-running]');
          if (phase === 'global-setup')
            expect(cli.log).toContain('[setup-finished]');
          expect(
            existsSync(
              join(fixturesTargetPath, 'coverage/coverage-final.json'),
            ),
          ).toBe(false);
          if (phase !== 'run-start') {
            expect(cli.stdout.match(/Perfetto trace file:/g)).toHaveLength(1);
            expect(cli.stdout.match(/Trace summary file:/g)).toHaveLength(1);
          }
          expect(cli.log).not.toContain('pool is closed');
          expect(cli.log).not.toContain('Worker stopped');
          expect(cli.log).not.toContain('exited unexpectedly');
          expect(
            cli.stdout.match(/\[global-teardown-default\] executed/g) ?? [],
          ).toHaveLength(phase === 'run-start' ? 0 : 1);
          expect(
            cli.stdout.match(/\[global-teardown-named\] executed/g) ?? [],
          ).toHaveLength(phase === 'run-start' ? 0 : 1);
          expect(
            cli.stdout.match(/\[rstest-dev-server\] closed/g),
          ).toHaveLength(1);
          if (phase !== 'run-start') {
            expect(
              cli.stdout.indexOf('[rstest-dev-server] closed'),
            ).toBeLessThan(
              cli.stdout.indexOf('[global-teardown-default] executed'),
            );
          }
        } finally {
          await cli.killProcessTree();
          fs.delete(fixturesTargetPath);
        }
      },
    );
  });

  it('should run global setup file correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          // This test spawns nested `rstest` runs. In the e2e `test:no-isolate`
          // step we set `ISOLATE=false`, which would be inherited by the child
          // process and make the nested run non-isolated as well (flaky on CI).
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter((log) => log.includes('['));

    expect(logs).toMatchInlineSnapshot(`
      [
        "[global-setup-default] executed",
        "[global-setup-named] executed",
        "[rstest] Running basic tests",
        "[rstest] Running basic tests",
        "[rstest-dev-server] closed",
        "[global-teardown-named] executed",
        "[global-teardown-default] executed",
      ]
    `);
  });

  it('should close list resources before global teardown', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();

    const cleanupLogs = cli.stdout
      .split('\n')
      .filter(
        (log) =>
          log.includes('[rstest-dev-server]') ||
          log.includes('[global-teardown-default]'),
      );
    expect(cleanupLogs).toEqual([
      '[rstest-dev-server] closed',
      '[global-teardown-default] executed',
    ]);
  });

  it('should fail when global setup throws an error', async () => {
    const { expectStderrLog, expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: join(__dirname, 'fixtures/error'),
        },
      },
    });

    await expectExecFailed();

    expect(cli.log).not.toContain('This should not be printed');

    // Check for global setup error message
    expectStderrLog(/Global setup failed intentionally/);
    expectStderrLog(/globalSetup\.ts:2/);
  });

  it('should fail when global teardown throws an error', async () => {
    const { expectStderrLog, expectLog, expectExecFailed } = await runRstestCli(
      {
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            env: { ISOLATE: undefined },
            cwd: join(__dirname, 'fixtures/teardown-error'),
          },
        },
      },
    );

    await expectExecFailed();

    expectLog(/This should be printed/);

    // Check for global setup error message
    expectStderrLog(/Global teardown failed intentionally/);
    expectStderrLog(/globalSetup\.ts:3/);
  });

  it('retries failed globalSetup on the next watch cycle and keeps a successful claim', async () => {
    const fixturesTargetPath = join(
      __dirname,
      'fixtures-test-watch-setup-retry',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures/error'),
      fixturesTargetPath,
    });
    fs.update(
      join(fixturesTargetPath, 'globalSetup.ts'),
      `import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function globalSetup() {
  if (!existsSync(join(dirname(fileURLToPath(import.meta.url)), 'ok.flag'))) {
    throw new Error('Global setup failed intentionally');
  }
  console.log('[global-setup-retry] executed');
  return () => console.log('[global-teardown-retry] executed');
}`,
    );
    fs.create(
      join(fixturesTargetPath, 'second.test.ts'),
      `import { describe, it } from '@rstest/core';
describe('second file', () => {
  it('passes after setup succeeds', () => {});
});`,
    );
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { ISOLATE: undefined },
          cwd: fixturesTargetPath,
        },
      },
    });

    try {
      await cli.waitForStderr('Global setup failed intentionally');
      await cli.waitForStdout('Waiting for file changes...');
      fs.create(join(fixturesTargetPath, 'ok.flag'), '');
      fs.update(
        join(fixturesTargetPath, 'index.test.ts'),
        (content) => `${content}\n// trigger setup retry`,
      );
      await cli.waitForStdout('Test Files 2 passed');
      expect(cli.stdout.match(/\[global-setup-retry\] executed/g)).toHaveLength(
        1,
      );

      cli.resetStd();
      fs.update(
        join(fixturesTargetPath, 'index.test.ts'),
        (content) => `${content}\n// trigger another cycle`,
      );
      // The summary retains results from files not rerun in this cycle.
      await cli.waitForStdout('Test Files 2 passed');
      expect(cli.stdout).toContain('index.test.ts (1)');
      expect(cli.stdout).not.toContain('[global-setup-retry] executed');
      expect(cli.stdout).not.toContain('second.test.ts');
    } finally {
      await cli.killProcessTree();
      fs.delete(fixturesTargetPath);
    }
  }, 60_000);

  it.skipIf(process.platform === 'win32')(
    'tears down the current watch session on SIGINT after a config restart',
    async () => {
      const fixturesTargetPath = join(
        __dirname,
        'fixtures-test-watch-restart-signal',
      );
      const { fs } = await prepareFixtures({
        fixturesPath: join(__dirname, 'fixtures/basic'),
        fixturesTargetPath,
      });
      const configPath = join(fixturesTargetPath, 'rstest.config.ts');
      const result = await runRstestCli({
        command: 'rstest',
        args: ['watch', '--disableConsoleIntercept'],
        options: {
          nodeOptions: {
            env: { ISOLATE: undefined },
            cwd: fixturesTargetPath,
          },
        },
      });
      const { cli } = result;

      try {
        await cli.waitForStdout('Waiting for file changes...');
        cli.resetStd();
        fs.update(configPath, (content) => `${content}\n// trigger restart`);

        await cli.waitForStdout('restarting Rstest');
        await cli.waitForStdout('[global-setup-default] executed');
        await cli.waitForStdout('Waiting for file changes...');

        cli.exec.process!.kill('SIGINT');
        await result.expectExecFailed();

        expect(cli.exec.process!.exitCode).toBe(130);
        expect(
          cli.stdout.match(/\[global-teardown-default\] executed/g),
        ).toHaveLength(2);
        expect(
          cli.stdout
            .split('\n')
            .filter(
              (log) =>
                log.includes('[rstest-dev-server]') ||
                log.includes('[global-teardown-default]'),
            ),
        ).toEqual([
          '[rstest-dev-server] closed',
          '[global-teardown-default] executed',
          '[rstest-dev-server] closed',
          '[global-teardown-default] executed',
        ]);
      } finally {
        await cli.killProcessTree();
        fs.delete(fixturesTargetPath);
      }
    },
    60_000,
  );
});
