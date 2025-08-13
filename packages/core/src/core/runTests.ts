import { createPool } from '../pool';
import type { RstestContext, TestFileResult } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function runTests(context: RstestContext): Promise<void> {
  const {
    normalizedConfig: {
      include,
      exclude,
      root,
      name,
      setupFiles: setups,
      includeSource,
    },
    rootPath,
    reporters,
    snapshotManager,
    command,
  } = context;

  const entriesCache = new Map<
    string,
    {
      entries: Record<string, string>;
      fileFilters?: string[];
    }
  >();

  const globTestSourceEntries = async (): Promise<Record<string, string>> => {
    const entries = await getTestEntries({
      include,
      exclude,
      includeSource,
      root,
      fileFilters: context.fileFilters || [],
    });

    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    if (!Object.keys(entries).length) {
      logger.log(color.red('No test files found.'));
      logger.log('');
      if (context.fileFilters?.length) {
        logger.log(
          color.gray('filter: '),
          context.fileFilters.join(color.gray(', ')),
        );
      }
      logger.log(color.gray('include:'), include.join(color.gray(', ')));
      logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
      logger.log('');
    }

    return entries;
  };

  const setupFiles = getSetupFiles(setups, rootPath);

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    name,
    normalizedConfig: context.normalizedConfig,
    globTestSourceEntries:
      command === 'watch'
        ? globTestSourceEntries
        : async () => {
            if (entriesCache.has(name)) {
              return entriesCache.get(name)!.entries;
            }
            return globTestSourceEntries();
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
  let buildHash: string | undefined;

  const run = async ({ fileFilters }: { fileFilters?: string[] } = {}) => {
    const {
      entries,
      setupEntries,
      assetFiles,
      sourceMaps,
      getSourcemap,
      buildTime,
      hash,
    } = await getRsbuildStats({ fileFilters });
    const testStart = Date.now();

    const { results, testResults } = await pool.runTests({
      context,
      entries,
      sourceMaps,
      setupEntries,
      assetFiles,
      updateSnapshot: snapshotManager.options.updateSnapshot,
    });

    const actualBuildTime = buildHash === hash ? 0 : buildTime;

    const testTime = Date.now() - testStart;

    const duration = {
      totalTime: testTime + actualBuildTime,
      buildTime: actualBuildTime,
      testTime,
    };

    buildHash = hash;

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
        getSourcemap,
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
            context.normalizedConfig.testNamePattern = undefined;
            context.fileFilters = undefined;

            // TODO: should rerun compile with new entries
            await run();
            afterTestsWatchRun();
          },
          runWithTestNamePattern: async (pattern?: string) => {
            clearLogs();
            // Update testNamePattern for current run
            context.normalizedConfig.testNamePattern = pattern;

            if (pattern) {
              logger.log(
                `\n${color.dim('Applied testNamePattern:')} ${color.bold(pattern)}`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared testNamePattern filter')}`);
            }
            snapshotManager.clear();
            await run();
            afterTestsWatchRun();
          },
          runWithFileFilters: async (filters?: string[]) => {
            clearLogs();
            if (filters && filters.length > 0) {
              logger.log(
                `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared file filters')}`);
            }
            snapshotManager.clear();
            context.fileFilters = filters;
            const entries = await globTestSourceEntries();

            if (!Object.keys(entries).length) {
              return;
            }
            await run({ fileFilters: Object.values(entries) });
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

            await run({ fileFilters: failedTests });
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
