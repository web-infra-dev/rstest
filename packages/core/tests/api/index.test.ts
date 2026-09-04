import { mkdirSync, writeFileSync } from 'node:fs';
import { createRstest as createBuiltRstest } from '@rstest/core/api';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { createRstest } from '../../src/api';
import type { RstestConfig } from '../../src/types';
import { withTempDir } from '../helpers/tempDir';
import { emptyDuration, emptySnapshotSummary } from '../reporter/helpers';

const defaultReporterConfig = [
  [
    'default',
    {
      logger: {
        outputStream: process.stdout,
        errorStream: process.stderr,
        getColumns: () => 80,
      },
    },
  ],
] satisfies RstestConfig['reporters'];

const withProcessOutputState = async (
  callback: (state: {
    stdoutWrite: typeof process.stdout.write;
    stderrWrite: typeof process.stderr.write;
    exitListenerCount: number;
  }) => Promise<void>,
): Promise<void> => {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const exitListenerCount = process.listenerCount('exit');
  try {
    await callback({ stdoutWrite, stderrWrite, exitListenerCount });
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
};

describe('createRstest', () => {
  it('uses config file provenance for build cache dependencies', async () => {
    await withTempDir('rstest-api-config-', async (root) => {
      for (const filePath of [
        join(root, 'configs/rstest.config.mts'),
        'configs/rstest.config.mts',
      ]) {
        const rstest = await createRstest({
          cwd: root,
          config: {
            content: {
              root: './project',
              performance: {
                buildCache: {
                  buildDependencies: ['./cache-flags.ts'],
                },
              },
            },
            filePath,
          },
        });

        expect(rstest.context.config.performance?.buildCache).toMatchObject({
          buildDependencies: [join(root, 'configs/cache-flags.ts')],
        });
      }
    });
  });

  it('does not instantiate reporters for the metadata snapshot', async () => {
    await withProcessOutputState(async (state) => {
      const config = {
        reporters: defaultReporterConfig,
      } satisfies RstestConfig;

      for (let index = 0; index < 2; index++) {
        const rstest = await createRstest({ config });

        expect(rstest.context.config.reporters).toBe(config.reporters);
        expect(process.stdout.write).toBe(state.stdoutWrite);
        expect(process.stderr.write).toBe(state.stderrWrite);
        expect(process.listenerCount('exit')).toBe(state.exitListenerCount);
      }
    });
  });

  it('rejects unmatched selectors when explicit projects are configured', async () => {
    await withTempDir('rstest-api-project-filter-', async (root) => {
      const projectRoot = join(root, 'alpha');
      mkdirSync(projectRoot);
      writeFileSync(join(root, 'root.test.js'), "test('root', () => {});\n");
      writeFileSync(
        join(projectRoot, 'alpha.test.js'),
        "test('alpha', () => {});\n",
      );
      const rstest = await createBuiltRstest({
        cwd: root,
        config: {
          globals: true,
          reporters: [],
          projects: [
            {
              name: 'alpha',
              root: './alpha',
              globals: true,
              include: ['alpha.test.js'],
            },
          ],
        },
      });
      const project = ['missing'];
      const message = 'No projects found';

      const result = await rstest.run({ project });
      expect(result.status).toBe('error');
      expect(result.unhandledErrors).toHaveLength(1);
      const [error] = result.unhandledErrors;
      const errorMessage = stripAnsi(error?.message ?? '');
      expect(errorMessage).toMatch(/^No projects found,/);
      expect(errorMessage).toContain('projectName filter: [\n  "missing"\n]');
      await expect(rstest.watch({ project })).rejects.toThrow(message);
      await expect(rstest.listTests({ project })).rejects.toThrow(message);
    });
  });

  it('ignores project selectors for an implicit root project like the CLI', async () => {
    await withTempDir('rstest-api-root-project-filter-', async (root) => {
      writeFileSync(join(root, 'root.test.js'), "test('root', () => {});\n");
      const rstest = await createBuiltRstest({
        cwd: root,
        config: {
          globals: true,
          include: ['root.test.js'],
          reporters: [],
        },
      });
      const project = ['missing'];

      await expect(rstest.run({ project })).resolves.toMatchObject({
        status: 'pass',
        summary: { tests: { total: 1 } },
      });
    });
  });

  it('exposes the default project and listed test metadata', async () => {
    await withTempDir('rstest-api-default-project-', async (root) => {
      const testPath = join(root, 'root.test.js');
      writeFileSync(
        testPath,
        "describe('suite', () => { test('case', () => {}); });\n",
      );
      const rstest = await createBuiltRstest({
        cwd: root,
        config: {
          globals: true,
          include: ['root.test.js'],
          reporters: [],
        },
      });

      expect(rstest.context.projects).toHaveLength(1);
      expect(rstest.context.projects[0]).toMatchObject({
        name: 'rstest',
        rootPath: root,
      });

      const listed = await rstest.listTests({ includeSuites: true });
      expect(
        listed.map(({ project, testPath, name, fullName, type }) => ({
          project,
          testPath,
          name,
          fullName,
          type,
        })),
      ).toEqual([
        {
          project: 'rstest',
          testPath,
          name: 'suite',
          fullName: 'suite',
          type: 'suite',
        },
        {
          project: 'rstest',
          testPath,
          name: 'case',
          fullName: 'suite > case',
          type: 'case',
        },
      ]);

      const [file] = await rstest.listTests({ filesOnly: true });
      expect(file).toEqual({ project: 'rstest', testPath, type: 'file' });
      expect(file).not.toHaveProperty('name');
      expect(file).not.toHaveProperty('fullName');
    });
  });

  it('reports a non-integer shard as an operation error', async () => {
    await withTempDir('rstest-api-invalid-shard-', async (root) => {
      const rstest = await createBuiltRstest({
        cwd: root,
        config: { reporters: [] },
      });

      const result = await rstest.run({
        shard: { index: 1.5, count: 2 },
      });

      expect(result.status).toBe('error');
      expect(result.unhandledErrors).toHaveLength(1);
      expect(result.unhandledErrors[0]?.message).toContain(
        'Invalid shard option: 1.5/2',
      );
    });
  });

  it('reports zero-match status according to the operation semantics', async () => {
    await withTempDir('rstest-api-zero-match-', async (root) => {
      const rstest = await createRstest({
        cwd: root,
        config: {
          include: ['*.test.js'],
          reporters: [],
        },
      });

      await expect(rstest.run()).resolves.toMatchObject({ status: 'fail' });
      await expect(
        rstest.run({ passWithNoTests: true }),
      ).resolves.toMatchObject({ status: 'pass' });

      let initialWatchStatus;
      const watcher = await rstest.watch({
        onResult(result) {
          initialWatchStatus = result.status;
        },
      });
      expect(initialWatchStatus).toBe('pass');
      await watcher.close();
    });
  });

  it('runs onExit for per-operation TTY reporters', async () => {
    await withTempDir('rstest-api-reporter-', async (root) => {
      writeFileSync(join(root, 'index.test.js'), "test('works', () => {});\n");
      await withProcessOutputState(async (state) => {
        const stdoutIsTTY = process.stdout.isTTY;
        const ci = process.env.CI;
        Object.defineProperty(process.stdout, 'isTTY', {
          configurable: true,
          value: true,
        });
        delete process.env.CI;

        try {
          const rstest = await createBuiltRstest({
            cwd: root,
            config: {
              globals: true,
              include: ['*.test.js'],
              reporters: [['default', { summary: false }]],
            },
          });

          for (let index = 0; index < 2; index++) {
            await expect(rstest.run()).resolves.toMatchObject({
              status: 'pass',
            });
            expect(process.stdout.write).toBe(state.stdoutWrite);
            expect(process.stderr.write).toBe(state.stderrWrite);
            expect(process.listenerCount('exit')).toBe(state.exitListenerCount);
          }
        } finally {
          Object.defineProperty(process.stdout, 'isTTY', {
            configurable: true,
            value: stdoutIsTTY,
          });
          if (ci === undefined) {
            delete process.env.CI;
          } else {
            process.env.CI = ci;
          }
        }
      });
    });
  });

  it('runs custom reporter onExit after run, merge, and watch close, but not list', async () => {
    await withTempDir('rstest-api-custom-reporter-', async (root) => {
      writeFileSync(join(root, 'index.test.js'), "test('works', () => {});\n");
      mkdirSync(join(root, '.rstest-reports'));
      writeFileSync(
        join(root, '.rstest-reports/blob.json'),
        JSON.stringify({
          version: RSTEST_VERSION,
          results: [],
          testResults: [],
          duration: emptyDuration,
          snapshotSummary: emptySnapshotSummary,
          files: {},
        }),
      );
      const onExit = rs.fn(async () => {});
      const rstest = await createBuiltRstest({
        cwd: root,
        config: {
          globals: true,
          include: ['index.test.js'],
          reporters: [{ onExit }],
        },
      });

      await rstest.run();
      expect(onExit).toHaveBeenCalledTimes(1);

      await rstest.listTests();
      // List contexts attach no reporters, so they have no onExit hook to run.
      expect(onExit).toHaveBeenCalledTimes(1);

      await rstest.mergeReports();
      expect(onExit).toHaveBeenCalledTimes(2);

      const watcher = await rstest.watch();
      expect(onExit).toHaveBeenCalledTimes(2);
      await watcher.close();
      expect(onExit).toHaveBeenCalledTimes(3);
    });
  });

  it('does not replace a run result with a reporter onExit error', async () => {
    await withTempDir('rstest-api-reporter-on-exit-error-', async (root) => {
      writeFileSync(join(root, 'index.test.js'), "test('works', () => {});\n");
      const rstest = await createBuiltRstest({
        cwd: root,
        config: {
          globals: true,
          include: ['index.test.js'],
          reporters: [
            {
              onExit() {
                throw new Error('onExit failed');
              },
            },
          ],
        },
      });

      await expect(rstest.run()).resolves.toMatchObject({ status: 'pass' });
    });
  });

  it('runs onExit when watch creation rejects blob reporting', async () => {
    await withTempDir('rstest-api-watch-blob-', async (root) => {
      await withProcessOutputState(async (state) => {
        const onExit = rs.fn();
        const rstest = await createBuiltRstest({
          cwd: root,
          config: {
            reporters: [...defaultReporterConfig, { onExit }, 'blob'],
          },
        });

        await expect(rstest.watch()).rejects.toThrow(
          'Blob reporter is not supported in watch mode.',
        );
        expect(onExit).toHaveBeenCalledTimes(1);
        expect(process.stdout.write).toBe(state.stdoutWrite);
        expect(process.stderr.write).toBe(state.stderrWrite);
        expect(process.listenerCount('exit')).toBe(state.exitListenerCount);
      });
    });
  });
});
