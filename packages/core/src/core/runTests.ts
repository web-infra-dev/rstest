import { createPool } from '../pool';
import type { EntryInfo, RstestContext, TestFileResult } from '../types';
import {
  color,
  getSetupFiles,
  getTestEntries,
  isDebug,
  logger,
} from '../utils';
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
          (acc, entry) => acc + Object.keys(entry.entries).length,
          0,
        );

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  let testFileResult: TestFileResult[] = [];
  let buildHash: string | undefined;

  type RunMode = 'all-failed' | 'all' | 'on-demand';
  const run = async ({
    fileFilters,
    runMode = 'on-demand',
  }: {
    fileFilters?: string[];
    runMode?: RunMode;
  } = {}) => {
    const {
      entries,
      setupEntries,
      assetFiles,
      sourceMaps,
      getSourcemap,
      buildTime,
      hash,
      changedEntries,
    } = await getRsbuildStats({ fileFilters });
    const testStart = Date.now();

    let finalEntries: EntryInfo[] = entries;
    if (runMode === 'on-demand') {
      if (changedEntries?.length) {
        logger.debug(
          color.yellow('Test files to re-run:\n') +
            changedEntries.map((e) => e.testPath).join('\n') +
            '\n',
        );
      } else if (changedEntries?.length === 0) {
        logger.debug(color.yellow('No test files are re-run.'));
      } else {
        logger.debug(color.yellow('Fully run test files.\n'));
      }
      finalEntries = changedEntries ?? entries;
    }

    console.log('🌂', finalEntries, runMode);

    const { results, testResults } = await pool.runTests({
      context,
      entries: finalEntries,
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
      if (!isDebug()) {
        console.clear();
      }
    };

    const { onBeforeRestart } = await import('./restart');

    onBeforeRestart(async () => {
      await pool.close();
      await closeServer();
    });

    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      if (!isFirstCompile) {
        clearLogs();
      }
    });

    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run();

      if (isFirstCompile && enableCliShortcuts) {
        const closeCliShortcuts = await setupCliShortcuts({
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
                `\n${color.dim('Applied testNamePattern:')} ${color.bold(pattern)}\n`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared testNamePattern filter')}\n`);
            }
            snapshotManager.clear();
            await run();
            afterTestsWatchRun();
          },
          runWithFileFilters: async (filters?: string[]) => {
            clearLogs();
            if (filters && filters.length > 0) {
              logger.log(
                `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}\n`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared file filters')}\n`);
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

            await run({ fileFilters: failedTests, runMode: 'all-failed' });
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
            const failedTests = testFileResult
              .filter((result) => result.snapshotResult?.unmatched)
              .map((r) => r.testPath);

            clearLogs();

            const originalUpdateSnapshot =
              snapshotManager.options.updateSnapshot;
            snapshotManager.clear();
            snapshotManager.options.updateSnapshot = 'all';
            await run({ fileFilters: failedTests });
            afterTestsWatchRun();
            snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
          },
        });

        onBeforeRestart(closeCliShortcuts);
      }

      afterTestsWatchRun();
    });
  } else {
    await run();
    await pool.close();
    await closeServer();
  }
}
