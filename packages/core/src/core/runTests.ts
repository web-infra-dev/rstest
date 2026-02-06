import { createCoverageProvider } from '../coverage';
import { createPool } from '../pool';
import type { EntryInfo, ProjectEntries } from '../types';
import {
  clearScreen,
  color,
  getTestEntries,
  logger,
  resolveShardedEntries,
} from '../utils';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  loadBrowserModule,
} from './browserLoader';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { runGlobalSetup, runGlobalTeardown } from './globalSetup';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';

/**
 * Run browser mode tests.
 * Returns the result for unified reporter output.
 */
async function runBrowserModeTests(
  context: Rstest,
  browserProjects: typeof context.projects,
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, runBrowserTests } = await loadBrowserModule({
    projectRoots,
  });
  validateBrowserConfig(context);
  return runBrowserTests(context, options);
}

export async function runTests(context: Rstest): Promise<void> {
  // Separate browser mode and node mode projects
  const browserProjects = context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
  const nodeProjects = context.projects.filter(
    (project) => !project.normalizedConfig.browser.enabled,
  );

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // For non-watch mode with both browser and node tests, we need to unify reporter output
  const shouldUnifyReporter =
    !isWatchMode && hasBrowserProjects && hasNodeProjects;

  // If only browser tests, run them and generate coverage
  if (hasBrowserProjects && !hasNodeProjects) {
    const { coverage } = context.normalizedConfig;

    if (coverage.enabled) {
      logger.log(
        ` ${color.gray('Coverage enabled with')} %s\n`,
        color.yellow(coverage.provider),
      );
    }

    const browserResult = await runBrowserModeTests(context, browserProjects, {
      skipOnTestRunEnd: false,
    });

    // Generate coverage reports for browser-only tests when execution produced test results.
    // Skip coverage on early startup failures surfaced via unhandledErrors.
    if (
      coverage.enabled &&
      browserResult?.results.length &&
      !browserResult.unhandledErrors?.length
    ) {
      const coverageProvider = await createCoverageProvider(
        coverage,
        context.rootPath,
      );
      if (coverageProvider) {
        const { generateCoverage } = await import('../coverage/generate');
        await generateCoverage(
          context,
          browserResult.results,
          coverageProvider,
        );
      }
    }

    return;
  }

  // If only node tests, run them (handled below)
  // If both, run them in parallel

  let browserResultPromise: Promise<BrowserTestRunResult | void> | undefined;

  const allProjects = context.projects;

  const { rootPath, reporters, snapshotManager, command, normalizedConfig } =
    context;
  const { coverage, shard } = normalizedConfig;

  const entriesCache: Map<string, ProjectEntries> =
    (await resolveShardedEntries(context)) || new Map();

  // Define globTestSourceEntries after entriesCache is potentially populated
  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (!isWatchMode && shard && entriesCache.has(name)) {
      return entriesCache.get(name)!.entries;
    }
    const { include, exclude, includeSource, root } = allProjects.find(
      (p) => p.environmentName === name,
    )!.normalizedConfig;
    const entries = await getTestEntries({
      include,
      exclude: exclude.patterns,
      includeSource,
      rootPath,
      projectRoot: root,
      fileFilters: context.fileFilters || [],
    });

    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    return entries;
  };

  let browserProjectsToRun = browserProjects;
  let nodeProjectsToRun = nodeProjects;

  if (shard) {
    browserProjectsToRun = browserProjects.filter((p) => {
      return (
        Object.keys(entriesCache.get(p.environmentName)?.entries || {}).length >
        0
      );
    });
    nodeProjectsToRun = nodeProjects.filter((p) => {
      return (
        Object.keys(entriesCache.get(p.environmentName)?.entries || {}).length >
        0
      );
    });
  }

  const hasBrowserTestsToRun = browserProjectsToRun.length > 0;
  const hasNodeTestsToRun = nodeProjectsToRun.length > 0;

  // If there are browser tests to run, start them.
  if (hasBrowserTestsToRun) {
    const browserEntries = new Map();
    if (shard) {
      for (const p of browserProjectsToRun) {
        browserEntries.set(
          p.environmentName,
          entriesCache.get(p.environmentName),
        );
      }
    }
    browserResultPromise = runBrowserModeTests(context, browserProjectsToRun, {
      skipOnTestRunEnd: shouldUnifyReporter,
      shardedEntries: shard ? browserEntries : undefined,
    });

    // Prevent an unhandled rejection window in mixed node+browser runs.
    // We still await the original promise later to surface the error.
    browserResultPromise.catch(() => undefined);
  }

  // If there are no node tests to run, we can potentially exit early.
  if (!hasNodeTestsToRun) {
    if (browserResultPromise) {
      await browserResultPromise;
    }
    // If only browser tests were to run and they ran, we should return.
    if (hasBrowserTestsToRun) {
      return;
    }
    // If no node projects at all, and no browser tests to run,
    // then nothing to do here. This handles the original early exit for no node projects.
    if (!hasNodeProjects) {
      return;
    }
  }

  // The `projects` variable now refers to node projects that have tests to run.
  const projects = nodeProjectsToRun;

  const { getSetupFiles } = await import('../utils/getSetupFiles');

  const setupFiles = Object.fromEntries(
    projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [environmentName, getSetupFiles(setupFiles, rootPath)];
    }),
  );

  const globalSetupFiles = Object.fromEntries(
    // Global setup still applies to all original projects in context
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { globalSetup },
      } = project;

      return [environmentName, getSetupFiles(globalSetup, rootPath)];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    inspectedConfig: {
      ...context.normalizedConfig,
      // Pass only the relevant node projects for Rsbuild processing
      projects: projects.map((p) => p.normalizedConfig),
    },
    isWatchMode,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    rsbuildInstance,
    rootPath,
  });

  const entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
    (acc, entry) => acc.concat(Object.values(entry.entries) || []),
    [],
  );

  const getRecommendWorkerCount = (): number => {
    // TODO: the best way is to create workers on demand
    const nodeEntries = Array.from(entriesCache.entries()).filter(([key]) => {
      const project = projects.find((p) => p.environmentName === key);
      return project?.normalizedConfig.browser.enabled !== true;
    });

    return nodeEntries.flatMap(
      ([_key, entry]) => Object.values(entry.entries) || [],
    ).length;
  };

  const recommendWorkerCount =
    command === 'watch' ? Number.POSITIVE_INFINITY : getRecommendWorkerCount();

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  // Initialize coverage collector
  const coverageProvider = coverage.enabled
    ? await createCoverageProvider(coverage, context.rootPath)
    : null;

  if (coverageProvider) {
    logger.log(
      ` ${color.gray('Coverage enabled with')} %s\n`,
      color.yellow(coverage.provider),
    );
  }

  type Mode = 'all' | 'on-demand';

  const run = async ({
    fileFilters,
    mode = 'all',
    buildStart = Date.now(),
  }: {
    fileFilters?: string[];
    mode?: Mode;
    buildStart?: number;
  } = {}) => {
    for (const reporter of reporters) {
      await reporter.onTestRunStart?.();
    }

    let testStart: number;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    context.stateManager.reset();

    // TODO: this is not the best practice for collecting test files
    context.stateManager.testFiles = isWatchMode ? undefined : entryFiles;

    const returns = await Promise.all(
      projects.map(async (p) => {
        const {
          assetNames,
          entries,
          setupEntries,
          globalSetupEntries,
          getAssetFiles,
          getSourceMaps,
          affectedEntries,
          deletedEntries,
        } = await getRsbuildStats({
          environmentName: p.environmentName,
          fileFilters,
        });

        testStart ??= Date.now();

        // Global setup only run once per project
        // Global setup runs only if there is at least one running test
        if (entries.length && globalSetupEntries.length && !p._globalSetups) {
          p._globalSetups = true;
          const files = globalSetupEntries.flatMap((e) => e.files!);
          const assetFiles = await getAssetFiles(files);
          const sourceMaps = await getSourceMaps(files);

          const { success, errors } = await runGlobalSetup({
            globalSetupEntries,
            assetFiles,
            sourceMaps,
            interopDefault: true,
            outputModule: p.outputModule,
          });
          if (!success) {
            return {
              results: [],
              testResults: [],
              errors,
              assetNames,
              // sourcemap is useless since we install source-map-support in worker
              getSourceMaps: () => null,
            };
          }
        }

        currentDeletedEntries.push(...deletedEntries);

        let finalEntries: EntryInfo[] = entries;
        if (mode === 'on-demand') {
          if (affectedEntries.length === 0) {
            logger.debug(
              color.yellow(
                `No test files need re-run in project(${p.environmentName}).`,
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
          getSourceMaps,
          setupEntries,
          getAssetFiles,
          project: p,
          updateSnapshot: context.snapshotManager.options.updateSnapshot,
        });

        return {
          results,
          testResults,
          assetNames,
          getSourceMaps,
        };
      }),
    );

    const buildTime = testStart! - buildStart;

    const testTime = Date.now() - testStart!;

    // Wait for browser tests to complete if running in parallel
    const browserResult = browserResultPromise
      ? await browserResultPromise
      : undefined;

    // When unifying reporter output, combine browser and node durations
    const duration =
      shouldUnifyReporter && browserResult
        ? {
            totalTime: testTime + buildTime + browserResult.duration.totalTime,
            buildTime: buildTime + browserResult.duration.buildTime,
            testTime: testTime + browserResult.duration.testTime,
          }
        : {
            totalTime: testTime + buildTime,
            buildTime,
            testTime,
          };

    const results = returns.flatMap((r) => r.results);
    const testResults = returns.flatMap((r) => r.testResults);
    const errors = returns.flatMap((r) => r.errors || []);

    // Merge browser test results for coverage collection (only when unifying reporter output)
    // In watch mode, browser and node tests run independently with their own reporters,
    // so we should not merge stale browser results into node results
    if (shouldUnifyReporter && browserResult?.results) {
      results.push(...browserResult.results);
    }
    if (shouldUnifyReporter && browserResult?.testResults) {
      testResults.push(...browserResult.testResults);
    }
    if (shouldUnifyReporter && browserResult?.unhandledErrors) {
      errors.push(...browserResult.unhandledErrors);
    }

    context.updateReporterResultState(
      results,
      testResults,
      currentDeletedEntries,
    );

    // Check for failures including browser results when unified
    const nodeHasFailure =
      results.some((r) => r.status === 'fail') || errors.length;
    const browserHasFailure = shouldUnifyReporter && browserResult?.hasFailure;

    if (results.length === 0 && !errors.length) {
      if (command === 'watch') {
        if (mode === 'on-demand') {
          logger.log(color.yellow('No test files need re-run.'));
        } else {
          logger.log(color.yellow('No test files found.'));
        }
      } else {
        const code = context.normalizedConfig.passWithNoTests ? 0 : 1;

        const message = `No test files found, exiting with code ${code}.`;
        if (code === 0) {
          logger.log(color.yellow(message));
        } else {
          logger.error(color.red(message));
        }

        process.exitCode = code;
      }
      if (mode === 'all') {
        if (context.fileFilters?.length) {
          logger.log(
            color.gray('filter: '),
            context.fileFilters.join(color.gray(', ')),
          );
        }

        allProjects.forEach((p) => {
          if (allProjects.length > 1) {
            logger.log('');
            logger.log(color.gray('project:'), p.name);
          }
          logger.log(color.gray('root:'), p.rootPath);

          logger.log(
            color.gray('include:'),
            p.normalizedConfig.include.join(color.gray(', ')),
          );
          logger.log(
            color.gray('exclude:'),
            p.normalizedConfig.exclude.patterns.join(color.gray(', ')),
          );
        });
      }
    }

    const isFailure = nodeHasFailure || browserHasFailure;

    if (isFailure) {
      process.exitCode = 1;
    }

    for (const reporter of reporters) {
      await reporter.onTestRunEnd?.({
        results: context.reporterResults.results,
        testResults: context.reporterResults.testResults,
        unhandledErrors: errors,
        snapshotSummary: snapshotManager.summary,
        duration,
        getSourcemap: async (name: string) => {
          const resource = returns.find((r) => r.assetNames.includes(name));

          const sourceMap = (await resource?.getSourceMaps([name]))?.[name];
          return sourceMap ? JSON.parse(sourceMap) : null;
        },
        filterRerunTestPaths: currentEntries.length
          ? currentEntries.map((e) => e.testPath)
          : undefined,
      });
    }

    // Generate coverage reports after all tests complete
    if (coverageProvider && (!isFailure || coverage.reportOnFailure)) {
      const { generateCoverage } = await import('../coverage/generate');

      await generateCoverage(context, results, coverageProvider);
    }

    if (isFailure) {
      const bail = context.normalizedConfig.bail;

      if (bail && context.stateManager.getCountOfFailedTests() >= bail) {
        logger.log(
          color.yellow(
            `Test run aborted due to reaching the bail limit of ${bail} failed test(s).`,
          ),
        );
      }
    }
  };

  if (command === 'watch') {
    const enableCliShortcuts = isCliShortcutsEnabled();

    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runGlobalTeardown();
        await pool.close();
        await closeServer();
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

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

    onBeforeRestart(async () => {
      await runGlobalTeardown();
      await pool.close();
      await closeServer();
    });

    let buildStart: number | undefined;

    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      buildStart = Date.now();
      if (!isFirstCompile) {
        clearScreen();
      }
    });

    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run({ buildStart, mode: isFirstCompile ? 'all' : 'on-demand' });
      buildStart = undefined;

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

            // TODO: should rerun compile with new entries
            await run({ mode: 'all' });
            afterTestsWatchRun();
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
    let isTeardown = false;
    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runGlobalTeardown();
        await pool.close();
        await closeServer();
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const unExpectedExit = (code?: number) => {
      if (isTeardown) {
        logger.log(
          color.yellow(
            `Rstest exited unexpectedly with code ${code}, this is likely caused by test environment teardown.`,
          ),
        );
      } else {
        logger.log(
          color.red(
            `Rstest exited unexpectedly with code ${code}, terminating test run.`,
          ),
        );

        // Print which test files were running at time of crash
        const running = context.stateManager.runningModules;
        if (running.size > 0) {
          const files = [...running.keys()].join('\n  - ');
          logger.log(
            color.red(
              `Test files running at time of crash:\n  - ${files}`,
            ),
          );
        }

        // Run global teardown before exit
        runGlobalTeardown().catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });

        process.exitCode = 1;
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };

    process.on('exit', unExpectedExit);
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    try {
      await run();
      isTeardown = true;
      await pool.close();
      await closeServer();

      // Run global teardown after all tests are done
      await runGlobalTeardown();
    } finally {
      process.off('exit', unExpectedExit);
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    }
  }
}
