import { createPool } from '../pool';
import type { RstestContext, TestFileResult } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
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

  const entriesCache = new Map<string, Record<string, string>>();

  const globTestSourceEntries = async (): Promise<Record<string, string>> => {
    const entries = await getTestEntries({
      include,
      exclude,
      includeSource,
      root,
      fileFilters,
    });

    entriesCache.set(name, entries);

    if (!Object.keys(entries).length) {
      logger.log(color.red('No test files found.'));
      logger.log('');
      if (fileFilters.length) {
        logger.log(color.gray('filter: '), fileFilters.join(color.gray(', ')));
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
              return entriesCache.get(name)!;
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
    rsbuildInstance.onDevCompileDone(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run();

      if (isFirstCompile && enableCliShortcuts) {
        await setupCliShortcuts({
          closeServer: async () => {
            await pool.close();
            await closeServer();
          },
          runAll: async () => {
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
                  'No failed tests were found that needed to be rerun.',
                ),
              );
              return;
            }

            snapshotManager.clear();

            await run({ fileFilters: failedTests });
            afterTestsWatchRun();
          },
          updateSnapshot: async () => {
            if (!snapshotManager.summary.unmatched) {
              logger.log(
                color.yellow(
                  'No snapshots were found that needed to be updated.',
                ),
              );
              return;
            }
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
