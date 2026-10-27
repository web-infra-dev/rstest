import {
  cloneCoverageMapData,
  resolveAndMergeRawCoverage,
} from '../../coverage';
import { BlobReporter } from '../../reporter/blob';
import { computeSummary } from '../../reporter/utils';
import type {
  Duration,
  ExecutorCycleOutcome,
  SelectedTestFile,
  SourceMapInput,
  TestRunEndPayload,
  TestRunStartPayload,
} from '../../types';
import type { CoverageProvider } from '../../types/coverage';
import {
  bgColor,
  color,
  getNoTestFilesMessage,
  isDebug,
  flushOutputStreams,
  keepEventLoopAlive,
  logger,
  type TraceRun,
} from '../../utils';
import type { InternalContext } from '../../types';
import { toSerializedError } from '../../utils/error';
import { getFileTaskId } from '../../utils/helper';
import {
  drainReporterHooks,
  formatReporterError,
  recordReporterError,
} from './runnerEventSink';

const reportNoTestFiles = ({ context }: { context: InternalContext }): void => {
  if (context.command === 'watch') {
    logger.log(color.yellow('No test files found.'));
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

    context.exitCode.raise(code);
  }

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
};

export const notifyReportersOnTestRunStart = async (
  context: InternalContext,
  files: SelectedTestFile[],
): Promise<void> => {
  const payload: TestRunStartPayload = {
    files: files.map((file) => ({
      ...file,
      testId: getFileTaskId(file.testPath),
    })),
  };
  const failure = await keepEventLoopAlive(async () => {
    let firstFailure: Error | undefined;
    // Every reporter is notified even when an earlier one fails: a broken
    // reporter must not swallow the hook for the rest of the run.
    for (const [index, reporter] of context.reporters.entries()) {
      try {
        await reporter.onTestRunStart?.(payload);
      } catch (error) {
        const reporterError = formatReporterError(
          reporter,
          index,
          'onTestRunStart',
          error,
        );
        recordReporterError(context, reporterError);
        // The run cannot produce trustworthy results once a reporter failed
        // before it started, so the cycle aborts after this loop. The rejected
        // value is the recorded error itself, which keeps the failure a single
        // entry when every executor observes the same rejection.
        firstFailure ??= reporterError;
      }
    }
    return firstFailure;
  });
  if (failure) {
    throw failure;
  }
};

export const createRunStartBarrier = (
  context: InternalContext,
  executorCount: number,
): Array<(files: SelectedTestFile[]) => Promise<void>> => {
  const selections = Array.from({ length: executorCount }, () => {
    let resolve!: (files: SelectedTestFile[]) => void;
    const promise = new Promise<SelectedTestFile[]>((accept) => {
      resolve = accept;
    });
    return { promise, resolve };
  });
  const started = Promise.all(selections.map(({ promise }) => promise)).then(
    (files) => notifyReportersOnTestRunStart(context, files.flat()),
  );
  return selections.map(({ resolve }) => (files) => {
    resolve(files);
    return started;
  });
};

export const resolveRunStatus = ({
  exitCode,
  summary,
  unhandledErrors,
}: Pick<TestRunEndPayload, 'summary' | 'unhandledErrors'> & {
  exitCode: number;
}): TestRunEndPayload['status'] =>
  unhandledErrors.length
    ? 'error'
    : exitCode !== 0 || summary.files.failed > 0
      ? 'failed'
      : 'passed';

export const notifyReportersOnTestRunEnd = async ({
  context,
  payload,
}: {
  context: InternalContext;
  payload: TestRunEndPayload;
}): Promise<void> => {
  const failures: Error[] = [];
  for (const [index, reporter] of context.reporters.entries()) {
    try {
      await reporter.onTestRunEnd?.(payload);
    } catch (error) {
      failures.push(
        formatReporterError(reporter, index, 'onTestRunEnd', error),
      );
    } finally {
      if (reporter.flushOutputStreams !== false) {
        await flushOutputStreams();
      }
    }
  }
  if (!failures.length) {
    return;
  }
  // The payload has already been dispatched, so these failures cannot join its
  // `unhandledErrors`. Surface them here and fail the process instead.
  context.exitCode.raise(1);
  const { printError } = await import('../../utils/error');
  for (const failure of failures) {
    logger.stderr('');
    logger.stderr(bgColor('bgRed', ' Unhandled Reporter Error '));
    await printError(
      toSerializedError(failure),
      payload.getSourcemap,
      context.rootPath,
    );
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
  context: InternalContext,
  {
    outcomes,
    mode,
    isWatchMode,
    isInterrupted = () => false,
    reportersStarted = true,
    coverageProvider,
    reportOnFailure,
    traceRun,
  }: {
    outcomes: ExecutorCycleOutcome[];
    mode: 'all' | 'on-demand';
    isWatchMode: boolean;
    isInterrupted?: () => boolean;
    /**
     * Whether `onTestRunStart` fired for this cycle. False finalizes state
     * without `onTestRunEnd` or a coverage report: a run cancelled before it
     * started, or a watch cycle that ran nothing and has nothing to report.
     */
    reportersStarted?: boolean;
    coverageProvider: CoverageProvider | null;
    reportOnFailure: boolean;
    /**
     * The cycle's trace buffer — the one the run loop rotated in for it, so a
     * cycle's spans and the events an executor emitted during it land together.
     */
    traceRun: TraceRun;
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
  // A reporter failure before the run starts aborts every executor with the
  // same recorded error instance, and the same instance is also recorded for
  // the run, so identity dedupes the fan-out instead of counting one failure
  // once per executor. Distinct failures stay distinct because every reporter
  // hook call records its own error object.
  const errors = [
    ...new Set([
      ...outcomes.flatMap((o) => o.errors),
      ...(await drainReporterHooks(context)),
    ]),
  ];

  // Coverage flows through the outcome contract: merge every executor's istanbul
  // `map` into the run's map, then resolve the concatenated v8 `raw` batches.
  // Each executor owns its own per-file merge (node in the pool, browser at
  // outcome assembly), so nothing is read off individual results here.
  const mergedCoverageMap = isInterrupted()
    ? undefined
    : coverageProvider?.createCoverageMap();
  for (const outcome of outcomes) {
    if (outcome.coverage?.map) {
      mergedCoverageMap?.merge(outcome.coverage.map);
    }
  }

  const loadCoverageResources = async (
    filenames: string[],
    resource: 'loadAssetFiles' | 'loadSourceMaps',
  ) => {
    const loadedResources: Record<string, string> = {};
    await Promise.all(
      outcomes.map(async (outcome) => {
        const load = outcome.coverage?.[resource];
        Object.assign(loadedResources, await load?.(filenames));
      }),
    );
    return loadedResources;
  };

  const rawCoverageResults = outcomes.flatMap((o) => o.coverage?.raw ?? []);
  await resolveAndMergeRawCoverage({
    coverageProvider: isInterrupted() ? null : coverageProvider,
    mergedCoverageMap,
    rawCoverageResults,
    resolveOptions: {
      loadAssetFiles: (filenames) =>
        loadCoverageResources(filenames, 'loadAssetFiles'),
      loadSourceMaps: (filenames) =>
        loadCoverageResources(filenames, 'loadSourceMaps'),
    },
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
    results.some((r) => r.status === 'failed') || errors.length > 0;
  const noTestsDiscovered = results.length === 0 && errors.length === 0;
  const testPaths = outcomes.flatMap((o) => o.testPaths);
  const deletedTestPaths = outcomes.flatMap((o) => o.deletedTestPaths ?? []);

  context.updateReporterResultState(results, testResults, deletedTestPaths);

  // Only a scope the user chose says so; a rebuild's empty scope is not a run
  // (see `InternalContext.openReporterRun`).
  if (!isInterrupted() && noTestsDiscovered && mode === 'all') {
    reportNoTestFiles({ context });
  }

  if (isFailure) {
    context.exitCode.raise(1);
  }

  const collectedCoverage =
    !isInterrupted() && mergedCoverageMap
      ? cloneCoverageMapData(mergedCoverageMap)
      : undefined;

  const defersCoverageReport =
    coverageProvider?.supportsDeferredCoverageFinalization === true &&
    context.reporters.some((reporter) => reporter instanceof BlobReporter);

  // Blob output is a merge input, so final filtering, untested-file backfill,
  // reports, and thresholds belong to the merge-reports process that sees the
  // complete coverage map rather than to every partial shard.
  if (
    !isInterrupted() &&
    reportersStarted &&
    coverageProvider &&
    !defersCoverageReport &&
    (!isFailure || reportOnFailure)
  ) {
    const { generateCoverage } = await import('../../coverage/generate');
    await runLifecycleStep(
      'coverage report generation',
      async () =>
        !isInterrupted() &&
        generateCoverage(
          context,
          mergedCoverageMap!,
          coverageProvider,
          traceRun.span,
        ),
    );
  }

  await runLifecycleStep('trace run finalize', () => traceRun.finalize());

  if (reportersStarted) {
    const reporterResults = context.reporterResults.results;
    const summary = computeSummary(reporterResults);
    const unhandledErrors = errors.map(toSerializedError);
    await runLifecycleStep('reporter onTestRunEnd', () =>
      notifyReportersOnTestRunEnd({
        context,
        payload: {
          results: reporterResults,
          testResults: context.reporterResults.testResults,
          summary,
          status: resolveRunStatus({
            exitCode: context.exitCode.current,
            summary,
            unhandledErrors,
          }),
          coverage: collectedCoverage,
          duration,
          getSourcemap,
          unhandledErrors,
          snapshotSummary: context.snapshotManager.summary,
          rerunTestPaths: isWatchMode ? testPaths : undefined,
        },
      }),
    );
  }

  if (!isInterrupted() && isFailure) {
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
