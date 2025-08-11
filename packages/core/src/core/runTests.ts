import { createPool } from '../pool';
import type { RstestContext, TestFileResult } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const { rootPath, reporters, projects, snapshotManager, command } = context;

  const entriesCache = new Map<string, Record<string, string>>();

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    const { include, exclude, includeSource, root } = projects.find(
      (p) => p.environmentName === name,
    )!.normalizedConfig;
    const entries = await getTestEntries({
      include,
      exclude,
      includeSource,
      root,
      fileFilters,
    });

    entriesCache.set(name, entries);

    return entries;
  };

  const globalSetupFiles = getSetupFiles(
    context.normalizedConfig.setupFiles,
    rootPath,
  );

  const setupFiles = Object.fromEntries(
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [
        environmentName,
        {
          ...globalSetupFiles,
          ...getSetupFiles(setupFiles, rootPath),
        },
      ];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    normalizedConfig: context.normalizedConfig,
    globTestSourceEntries:
      command === 'watch'
        ? globTestSourceEntries
        : async (name) => {
            if (entriesCache.has(name)) {
              return entriesCache.get(name)!;
            }
            return globTestSourceEntries(name);
          },
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const recommendWorkerCount =
    command === 'watch'
      ? Number.POSITIVE_INFINITY
      : Array.from(entriesCache.values()).reduce(
          (acc, entries) => acc + Object.keys(entries).length,
          0,
        );

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  let testFileResult: TestFileResult[] = [];

  const run = async ({ failedTests }: { failedTests?: string[] } = {}) => {
    let testStart: number;
    const buildStart = Date.now();

    const returns = await Promise.all(
      context.projects.map(async (p) => {
        const { entries, setupEntries, assetFiles, sourceMaps } =
          await getRsbuildStats({
            environmentName: p.environmentName,
            fileFilters: failedTests,
          });

        testStart ??= Date.now();

        const { results, testResults } = await pool.runTests({
          entries,
          sourceMaps,
          setupEntries,
          assetFiles,
          project: p,
          updateSnapshot: context.snapshotManager.options.updateSnapshot,
        });

        return {
          results,
          testResults,
          sourceMaps,
        };
      }),
    );

    const buildTime = testStart! - buildStart;

    const testTime = Date.now() - testStart!;

    const duration = {
      totalTime: testTime + buildTime,
      buildTime,
      testTime,
    };

    const results = returns.flatMap((r) => r.results);
    const testResults = returns.flatMap((r) => r.testResults);
    const sourceMaps = Object.assign({}, ...returns.map((r) => r.sourceMaps));

    if (results.length === 0) {
      if (command === 'watch') {
        logger.log(color.yellow('No test files found\n'));
      } else {
        const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
        logger.log(
          color[code ? 'red' : 'yellow'](
            `No test files found, exiting with code ${code}\n`,
          ),
        );
        process.exitCode = code;
      }
      if (fileFilters.length) {
        logger.log(color.gray('filter: '), fileFilters.join(color.gray(', ')));
      }
    }

    testFileResult = results;

    if (results.some((r) => r.status === 'fail')) {
      process.exitCode = 1;
    }

    for (const reporter of reporters) {
      await reporter.onTestRunEnd?.({
        results,
        testResults,
        snapshotSummary: snapshotManager.summary,
        duration,
        getSourcemap: (name: string) => sourceMaps[name] || null,
      });
    }
  };

  if (command === 'watch') {
    const enableCliShortcuts = isCliShortcutsEnabled();

    const afterTestsWatchRun = () => {
      // TODO: support clean logs before dev recompile
      logger.log(color.green('  Waiting for file changes...'));

      if (enableCliShortcuts) {
        if (snapshotManager.summary.unmatched) {
          // highlight `u` when there are unmatched snapshots
          logger.log(
            `  ${color.dim('press')} ${color.yellow(color.bold('u'))} ${color.dim('to update snapshot')}${color.dim(', press')} ${color.bold('h')} ${color.dim('to show help')}\n`,
          );
        } else {
          logger.log(
            `  ${color.dim('press')} ${color.bold('h')} ${color.dim('to show help')}${color.dim(', press')} ${color.bold('q')} ${color.dim('to quit')}\n`,
          );
        }
      }
    };
    const clearLogs = () => {
      console.clear();
    };
    rsbuildInstance.onDevCompileDone(async ({ isFirstCompile }) => {
      // TODO: clean logs before dev recompile
      if (!isFirstCompile) {
        clearLogs();
      }
      snapshotManager.clear();
      await run();

      if (isFirstCompile && enableCliShortcuts) {
        await setupCliShortcuts({
          closeServer: async () => {
            await pool.close();
            await closeServer();
          },
          runAll: async () => {
            clearLogs();
            snapshotManager.clear();
            await run();
            afterTestsWatchRun();
          },
          runFailedTests: async () => {
            const failedTests = testFileResult
              .filter((result) => result.status === 'fail')
              .map((r) => r.testPath);

            if (!failedTests.length) {
              logger.log(
                color.yellow(
                  '\nNo failed tests were found that needed to be rerun.',
                ),
              );
              return;
            }

            clearLogs();

            snapshotManager.clear();

            await run({ failedTests });
            afterTestsWatchRun();
          },
          updateSnapshot: async () => {
            if (!snapshotManager.summary.unmatched) {
              logger.log(
                color.yellow(
                  '\nNo snapshots were found that needed to be updated.',
                ),
              );
              return;
            }

            clearLogs();

            const originalUpdateSnapshot =
              snapshotManager.options.updateSnapshot;
            snapshotManager.clear();
            snapshotManager.options.updateSnapshot = 'all';
            await run();
            afterTestsWatchRun();
            snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
          },
        });
      }

      afterTestsWatchRun();
    });
  } else {
    await run();
    await pool.close();
    await closeServer();
  }
}
