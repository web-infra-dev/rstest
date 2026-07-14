import { resolveAndMergeRawCoverage } from '../coverage';
import type { Duration, ExecutorCycleOutcome, SourceMapInput } from '../types';
import type { CoverageMap, CoverageProvider } from '../types/coverage';
import {
  color,
  getNoTestFilesMessage,
  isDebug,
  flushOutputStreams,
  logger,
  type TraceRun,
} from '../utils';
import type { Rstest } from './rstest';

export const reportNoTestFiles = ({
  context,
  mode = 'all',
}: {
  context: Rstest;
  mode?: 'all' | 'on-demand';
}): void => {
  if (context.command === 'watch') {
    if (mode === 'on-demand') {
      logger.log(color.yellow('No test files need re-run.'));
    } else {
      logger.log(color.yellow('No test files found.'));
    }
  } else {
    const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
    const message = getNoTestFilesMessage({
      context,
      code,
      defaultMessage: `No test files found, exiting with code ${code}.`,
    });

    if (code === 0) {
      logger.log(color.yellow(message));
    } else {
      logger.error(color.red(message));
    }

    // `process.exitCode` mutations here (and in deeper layers such as
    // globalSetup teardown, coverage threshold checks) are restored to their
    // pre-run value by `runRstest` in the embedded path via try/finally, so
    // we don't need to gate them per-call site. Never-downgrade: a zero code
    // (passWithNoTests) must not clear a prior non-zero code.
    if (
      code !== 0 ||
      process.exitCode === undefined ||
      process.exitCode === 0
    ) {
      process.exitCode = code;
    }
  }

  if (mode === 'all') {
    if (context.relatedFilters?.length) {
      logger.log(
        color.gray('related: '),
        context.relatedFilters.join(color.gray(', ')),
      );
    } else if (context.fileFilters?.length) {
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
};

export const notifyReportersOnTestRunStart = async (
  context: Rstest,
): Promise<void> => {
  for (const reporter of context.reporters) {
    await reporter.onTestRunStart?.();
  }
};

export const notifyReportersOnTestRunEnd = async ({
  context,
  coverage,
  duration,
  getSourcemap,
  unhandledErrors,
  filterRerunTestPaths,
}: {
  context: Rstest;
  coverage?: CoverageMap;
  duration: Duration;
  getSourcemap: (sourcePath: string) => Promise<SourceMapInput | null>;
  unhandledErrors?: Error[];
  filterRerunTestPaths?: string[];
}): Promise<void> => {
  for (const reporter of context.reporters) {
    await reporter.onTestRunEnd?.({
      results: context.reporterResults.results,
      coverage: coverage?.toJSON(),
      testResults: context.reporterResults.testResults,
      unhandledErrors,
      snapshotSummary: context.snapshotManager.summary,
      duration,
      getSourcemap,
      filterRerunTestPaths,
    });
    if (reporter.flushOutputStreams !== false) {
      await flushOutputStreams();
    }
  }
};

const isLifecycleDebugEnabled = isDebug();

type LifecycleStepOptions = {
  slowAfter?: number;
  slowMessage?: string;
  slowDoneMessage?: string;
};

export const runLifecycleStep = async <T>(
  label: string,
  fn: () => Promise<T>,
  options?: LifecycleStepOptions,
): Promise<T> => {
  const { slowAfter, slowMessage, slowDoneMessage } = options ?? {};
  let didShowSlowMessage = false;
  const slowTimer = slowMessage
    ? setTimeout(() => {
        didShowSlowMessage = true;
        logger.info(slowMessage);
      }, slowAfter ?? 1000)
    : undefined;

  if (!isLifecycleDebugEnabled) {
    try {
      const result = await fn();
      if (didShowSlowMessage && slowDoneMessage) {
        logger.info(slowDoneMessage);
      }
      return result;
    } finally {
      if (slowTimer) {
        clearTimeout(slowTimer);
      }
    }
  }

  const startTime = Date.now();
  logger.debug(`lifecycle: start ${label}`);

  try {
    const result = await fn();
    logger.debug(`lifecycle: finish ${label} (${Date.now() - startTime}ms)`);
    if (didShowSlowMessage && slowDoneMessage) {
      logger.info(slowDoneMessage);
    }
    return result;
  } catch (error) {
    logger.debug(`lifecycle: fail ${label} (${Date.now() - startTime}ms)`);
    throw error;
  } finally {
    if (slowTimer) {
      clearTimeout(slowTimer);
    }
  }
};

/**
 * The single finalize implementation shared by node-only, browser-only, and
 * mixed runs. Reduces every executor's {@link ExecutorCycleOutcome} into the
 * run verdict: merged results/errors, summed duration, coverage merge + report,
 * reporter `onTestRunEnd`, exit code, and the bail message.
 */
export async function finalizeRunCycle(
  context: Rstest,
  {
    outcomes,
    mode,
    isWatchMode,
    coverageProvider,
    reportOnFailure,
    traceRun,
    currentDeletedEntries,
  }: {
    outcomes: ExecutorCycleOutcome[];
    mode: 'all' | 'on-demand';
    isWatchMode: boolean;
    coverageProvider: CoverageProvider | null;
    reportOnFailure: boolean;
    traceRun: TraceRun;
    currentDeletedEntries: string[];
  },
): Promise<void> {
  // Combined route-aware source map resolver: try each executor's resolver in
  // order, fall through to null when none handles the path.
  const getSourcemap = async (
    sourcePath: string,
  ): Promise<SourceMapInput | null> => {
    for (const outcome of outcomes) {
      const resolved = await outcome.resolveSourcemap?.(sourcePath);
      if (resolved?.handled) {
        return resolved.sourcemap;
      }
    }
    return null;
  };

  const results = outcomes.flatMap((o) => o.results);
  const testResults = outcomes.flatMap((o) => o.testResults);
  const errors = outcomes.flatMap((o) => o.errors);

  // Coverage flows through the outcome contract: merge every executor's istanbul
  // `map` into the run's map, then resolve the concatenated v8 `raw` batches.
  // Each executor owns its own per-file merge (node in the pool, browser at
  // outcome assembly), so nothing is read off individual results here.
  const mergedCoverageMap = coverageProvider?.createCoverageMap();
  for (const outcome of outcomes) {
    if (outcome.coverage?.map) {
      mergedCoverageMap?.merge(outcome.coverage.map);
    }
  }

  await resolveAndMergeRawCoverage({
    coverageProvider,
    mergedCoverageMap,
    rawCoverageResults: outcomes.flatMap((o) => o.coverage?.raw ?? []),
    runCoverageStep: runLifecycleStep,
  });

  const summed = outcomes.reduce(
    (acc, o) => {
      acc.buildTime += o.duration.buildTime;
      acc.testTime += o.duration.testTime;
      return acc;
    },
    { buildTime: 0, testTime: 0 },
  );
  const duration: Duration = {
    totalTime: summed.buildTime + summed.testTime,
    buildTime: summed.buildTime,
    testTime: summed.testTime,
  };

  const isFailure =
    results.some((r) => r.status === 'fail') || errors.length > 0;
  const noTestsDiscovered = results.length === 0 && errors.length === 0;
  const testPaths = outcomes.flatMap((o) => o.testPaths);

  context.updateReporterResultState(
    results,
    testResults,
    currentDeletedEntries,
  );

  if (noTestsDiscovered) {
    reportNoTestFiles({ context, mode });
  }

  // Never-downgrade: a failure raises the code to 1 only when nothing has
  // already set a non-zero code (matches the browser host's
  // `ensureProcessExitCode`), so a pre-set exit code survives.
  if (isFailure && (process.exitCode === undefined || process.exitCode === 0)) {
    process.exitCode = 1;
  }

  await runLifecycleStep('reporter onTestRunEnd', () =>
    notifyReportersOnTestRunEnd({
      context,
      coverage: mergedCoverageMap,
      duration,
      getSourcemap,
      unhandledErrors: errors,
      // Only filter the failing-test summary in watch mode; a non-watch run
      // surfaces every executor's failures (Appendix A bug 2).
      filterRerunTestPaths:
        isWatchMode && testPaths.length ? testPaths : undefined,
    }),
  );

  if (coverageProvider && (!isFailure || reportOnFailure)) {
    const { generateCoverage } = await import('../coverage/generate');
    await runLifecycleStep('coverage report generation', () =>
      generateCoverage(
        context,
        mergedCoverageMap!,
        coverageProvider,
        traceRun.span,
      ),
    );
  }

  await runLifecycleStep('trace run finalize', () => traceRun.finalize());

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
}
