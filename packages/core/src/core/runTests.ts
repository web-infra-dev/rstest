import { createPool } from '../pool';
import type { EntryInfo } from '../types';
import {
  clearScreen,
  color,
  getSetupFiles,
  getTestEntries,
  logger,
} from '../utils';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';

export async function runTests(context: Rstest): Promise<void> {
  const { rootPath, reporters, projects, snapshotManager, command } = context;

  const entriesCache = new Map<
    string,
    {
      entries: Record<string, string>;
      fileFilters?: string[];
    }
  >();

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
      fileFilters: context.fileFilters || [],
    });

    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    return entries;
  };

  const setupFiles = Object.fromEntries(
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [environmentName, getSetupFiles(setupFiles, rootPath)];
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
              return entriesCache.get(name)!.entries;
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
          (acc, entry) => acc + Object.keys(entry.entries).length,
          0,
        );

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  type Mode = 'all' | 'on-demand';

  const run = async ({
    fileFilters,
    mode = 'all',
  }: {
    fileFilters?: string[];
    mode?: Mode;
  } = {}) => {
    let testStart: number;
    const buildStart = Date.now();
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    const returns = await Promise.all(
      context.projects.map(async (p) => {
        const {
          entries,
          setupEntries,
          assetFiles,
          sourceMaps,
          affectedEntries,
          deletedEntries,
        } = await getRsbuildStats({
          environmentName: p.environmentName,
          fileFilters,
        });

        testStart ??= Date.now();

        currentDeletedEntries.push(...deletedEntries);

        let finalEntries: EntryInfo[] = entries;
        if (mode === 'on-demand') {
          if (affectedEntries.length === 0) {
            logger.debug(
              color.yellow(
                `No test files are re-run in project(${p.environmentName}).`,
              ),
            );
          } else {
            logger.debug(
              color.yellow(
                `Test files to re-run in project(${p.environmentName}):\n`,
              ) +
                affectedEntries.map((e) => e.testPath).join('\n') +
                '\n',
            );
          }
          finalEntries = affectedEntries;
        } else {
          logger.debug(
            color.yellow(
              fileFilters?.length
                ? `Run filtered tests in project(${p.environmentName}).\n`
                : `Run all tests in project(${p.environmentName}).\n`,
            ),
          );
        }

        currentEntries.push(...finalEntries);
        const { results, testResults } = await pool.runTests({
          entries: finalEntries,
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

    context.updateReporterResultState(
      results,
      testResults,
      currentDeletedEntries,
    );

    if (results.length === 0) {
      if (command === 'watch') {
        if (mode === 'on-demand') {
          logger.log(color.yellow('No test files are re-run.'));
        } else {
          logger.log(color.yellow('No test files found.'));
        }
      } else {
        const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
        logger.log(
          color[code ? 'red' : 'yellow'](
            `No test files found, exiting with code ${code}.`,
          ),
        );
        process.exitCode = code;
      }
      if (mode === 'all') {
        if (context.fileFilters?.length) {
          logger.log(
            color.gray('filter: '),
            context.fileFilters.join(color.gray(', ')),
          );
        }

        context.projects.forEach((p) => {
          if (context.projects.length > 1) {
            logger.log('');
            logger.log(color.gray('project:'), p.name);
          }
          logger.log(
            color.gray('include:'),
            p.normalizedConfig.include.join(color.gray(', ')),
          );
          logger.log(
            color.gray('exclude:'),
            p.normalizedConfig.exclude.join(color.gray(', ')),
          );
        });
      }
    }

    if (results.some((r) => r.status === 'fail')) {
      process.exitCode = 1;
    }

    for (const reporter of reporters) {
      await reporter.onTestRunEnd?.({
        results: context.reporterResults.results,
        testResults: context.reporterResults.testResults,
        snapshotSummary: snapshotManager.summary,
        duration,
        getSourcemap: (name: string) => sourceMaps[name] || null,
        filterRerunTestPaths: currentEntries.length
          ? currentEntries.map((e) => e.testPath)
          : undefined,
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

    const { onBeforeRestart } = await import('./restart');
    const { triggerRerun } = await import('./plugins/entry');

    onBeforeRestart(async () => {
      await pool.close();
      await closeServer();
    });

    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      if (!isFirstCompile) {
        clearScreen();
      }
    });

    let forceRerunOnce = false;

    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run({
        mode: isFirstCompile || forceRerunOnce ? 'all' : 'on-demand',
      });

      if (isFirstCompile && enableCliShortcuts) {
        const closeCliShortcuts = await setupCliShortcuts({
          closeServer: async () => {
            await pool.close();
            await closeServer();
          },
          runAll: async () => {
            clearScreen();
            snapshotManager.clear();
            context.normalizedConfig.testNamePattern = undefined;
            context.fileFilters = undefined;

            forceRerunOnce = true;
            triggerRerun();
          },
          runWithTestNamePattern: async (pattern?: string) => {
            clearScreen();
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
            clearScreen();
            if (filters && filters.length > 0) {
              logger.log(
                `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}\n`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared file filters')}\n`);
            }
            snapshotManager.clear();
            context.fileFilters = filters;
            const entries = await Promise.all(
              projects.map(async (p) => {
                return globTestSourceEntries(p.environmentName);
              }),
            ).then((entries) =>
              entries.reduce<string[]>(
                (acc, entry) => acc.concat(...Object.values(entry)),
                [],
              ),
            );

            if (!entries.length) {
              logger.log(
                filters
                  ? color.yellow(
                      `\nNo matching test files to run with current file filters: ${filters.join(',')}\n`,
                    )
                  : color.yellow('\nNo matching test files to run.\n'),
              );
              return;
            }
            await run({ fileFilters: entries });
            afterTestsWatchRun();
          },
          runFailedTests: async () => {
            const failedTests = context.reporterResults.results
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

            clearScreen();

            snapshotManager.clear();

            await run({ fileFilters: failedTests, mode: 'all' });
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
            const failedTests = context.reporterResults.results
              .filter((result) => result.snapshotResult?.unmatched)
              .map((r) => r.testPath);

            clearScreen();

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
