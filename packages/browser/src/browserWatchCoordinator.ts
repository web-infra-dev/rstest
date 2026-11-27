import {
  color,
  type ExecutorCycleOutcome,
  logger,
  reporterFileKey,
  type SelectedTestFile,
  toSelectedTestFile,
} from '@rstest/core/internal/browser';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import {
  type BrowserRuntime,
  drainPendingAffectedTestFiles,
} from './browserRsbuild';
import { toError } from './hostPayloads';
import { getTestPathKey } from './pathUtils';
import type { BrowserProjectRuntime, TestFileInfo } from './protocol';
import {
  type BrowserWatchSession,
  expandToRows,
  groupRowsByProject,
  type HeadedLaneResult,
  type HeadlessLaneResult,
} from './schedulerSeam';
import { createSerialTaskQueue } from './serialTaskQueue';
import {
  collectWatchTestFiles,
  commitWatchFileSetUpdate,
  planWatchRerun,
} from './watchRerunPlanner';
import type { RequestedTestPaths, WatchSignals } from './watchSignals';

type BuildRerunOutcome = (options: {
  rerunTestPaths: string[];
  executedFileKeys?: ReadonlySet<string>;
  testTime: number;
  rawCoverage: unknown[];
  unhandledErrors?: Error[];
}) => ExecutorCycleOutcome;

type BrowserWatchCoordinatorDeps = {
  watchState: BrowserRuntime['watchState'];
  watchSignals: WatchSignals;
  headlessLane?: HeadlessLaneResult;
  headlessRows: readonly BrowserProjectRuntime[];
  headedLanes: readonly HeadedLaneResult[];
  collectProjectEntries: () => Promise<
    Parameters<typeof planWatchRerun>[0]['projectEntries']
  >;
  filterWatchTestPaths?: (testPaths: string[]) => string[];
  syncRuntimeConfig?: () => void;
  logWatchReady: () => void;
  hasMatchingTestPath: (
    testPaths: string[],
    files?: readonly TestFileInfo[],
  ) => boolean;
  getFatalCompileError: () => Error | undefined;
  fatalErrorRef: { current: Error | null };
  buildRerunOutcome: BuildRerunOutcome;
};

/**
 * Single controller-level owner of browser watch rerun planning and lane
 * coordination. Replaces per-scheduler watch planners so any mix of headless
 * and headed lanes (including multiple headed windows) shares one serialized
 * file-set diff, one invalidation pipeline, and parallel per-cycle execution.
 *
 * File changes and CLI shortcuts target every lane that owns the affected
 * paths; an in-page UI rerun button targets only the headed container window
 * where the user clicked, preserving per-file `testNamePattern` and keeping
 * sibling lanes untouched.
 */
export const createBrowserWatchCoordinator = ({
  watchState,
  watchSignals,
  headlessLane,
  headlessRows,
  headedLanes,
  collectProjectEntries,
  filterWatchTestPaths,
  syncRuntimeConfig,
  logWatchReady,
  hasMatchingTestPath,
  getFatalCompileError,
  fatalErrorRef,
  buildRerunOutcome,
}: BrowserWatchCoordinatorDeps): BrowserWatchSession => {
  const headlessRowsByProject = groupRowsByProject(headlessRows);

  // FIFO queue of per-cycle lane targets and per-container test-name patterns,
  // bound to the raw cycle handle returned by core's `onInvalidate`. When core
  // folds two triggers into one queued cycle it returns the same promise handle
  // (so targets merge); when it keeps two triggers as separate cycles (e.g.
  // differing `updateSnapshot` policies) it returns a new handle (so each
  // queued cycle keeps its own isolated targets and patterns).
  type QueuedCycleScope = {
    rawCycle: unknown;
    targets: Map<string, Set<string> | 'all'>;
    testNamePatterns: Map<string, Map<string, string>>;
  };
  const pendingCycleScopes: QueuedCycleScope[] = [];

  const getOrCreateCycleScope = (rawCycle: unknown): QueuedCycleScope => {
    const last = pendingCycleScopes.at(-1);
    if (rawCycle !== undefined && last && last.rawCycle === rawCycle) {
      return last;
    }
    const created: QueuedCycleScope = {
      rawCycle,
      targets: new Map(),
      testNamePatterns: new Map(),
    };
    pendingCycleScopes.push(created);
    return created;
  };

  const recordPathsForAll = (
    rawCycle: unknown,
    paths: readonly string[],
  ): void => {
    const scope = getOrCreateCycleScope(rawCycle);
    for (const testPath of paths) {
      const key = getTestPathKey(testPath);
      scope.targets.set(key, 'all');
      for (const patterns of scope.testNamePatterns.values()) {
        patterns.delete(key);
      }
    }
  };

  const recordPathForContainer = (
    rawCycle: unknown,
    testPath: string,
    containerId: string,
    testNamePattern?: string,
  ): void => {
    const scope = getOrCreateCycleScope(rawCycle);
    const key = getTestPathKey(testPath);
    const existing = scope.targets.get(key);
    if (existing !== 'all') {
      if (existing) {
        existing.add(containerId);
      } else {
        scope.targets.set(key, new Set([containerId]));
      }
    }
    let patterns = scope.testNamePatterns.get(containerId);
    if (!patterns) {
      patterns = new Map();
      scope.testNamePatterns.set(containerId, patterns);
    }
    if (testNamePattern === undefined) {
      patterns.delete(key);
    } else {
      patterns.set(key, testNamePattern);
    }
  };

  const claimCycleTargets = (testPaths: string[]) => {
    const cycleScope = pendingCycleScopes.shift();
    const targets = cycleScope?.targets;
    const testNamePatterns = cycleScope?.testNamePatterns;
    const headlessPaths: string[] = [];
    const headedPathsByContainer = new Map<string, string[]>(
      headedLanes.map((lane) => [lane.containerId, []]),
    );
    const selectedFiles: SelectedTestFile[] = [];
    const executedFileKeys = new Set<string>();
    const seenKeys = new Set<string>();

    for (const testPath of testPaths) {
      const key = getTestPathKey(testPath);
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      const target = targets?.get(key) ?? 'all';

      const matchingFiles = watchState.lastTestFiles.filter(
        (file) => getTestPathKey(file.testPath) === key,
      );

      if (target === 'all' && headlessLane) {
        let hasHeadlessMatch = false;
        for (const file of matchingFiles) {
          if (!headlessRowsByProject.has(file.projectName)) {
            continue;
          }
          hasHeadlessMatch = true;
          for (const expanded of expandToRows([file], headlessRowsByProject)) {
            selectedFiles.push(
              toSelectedTestFile(file.testPath, expanded.row.instanceName),
            );
            executedFileKeys.add(
              reporterFileKey(expanded.row.instanceName, file.testPath),
            );
          }
        }
        if (hasHeadlessMatch) {
          headlessPaths.push(testPath);
        }
      }

      for (const lane of headedLanes) {
        if (target !== 'all' && !target.has(lane.containerId)) {
          continue;
        }
        const match = matchingFiles.find(
          (file) => file.projectName === lane.row.name,
        );
        if (!match) {
          continue;
        }
        headedPathsByContainer.get(lane.containerId)!.push(testPath);
        selectedFiles.push(
          toSelectedTestFile(match.testPath, lane.row.instanceName),
        );
        executedFileKeys.add(
          reporterFileKey(lane.row.instanceName, match.testPath),
        );
      }
    }

    return {
      headlessPaths,
      headedPathsByContainer,
      testNamePatterns,
      selectedFiles,
      executedFileKeys,
    };
  };

  const runDispatchRerunOnce = async (
    updateSnapshot?: SnapshotUpdateState,
    requestedTestPaths?: RequestedTestPaths,
  ): Promise<void> => {
    try {
      const newProjectEntries = await collectProjectEntries();
      const rerunPlan = planWatchRerun({
        projectEntries: newProjectEntries,
        previousTestFiles: watchState.lastTestFiles,
        affectedTestFiles: drainPendingAffectedTestFiles(watchState),
        requestedTestPaths,
        filterTestPaths: filterWatchTestPaths,
      });

      commitWatchFileSetUpdate(rerunPlan.fileSetUpdate, watchState);
      watchState.removeFailureScreenshots?.(
        rerunPlan.fileSetUpdate?.deletedTestFiles ?? [],
      );
      const failureScreenshotCleanup =
        watchState.awaitFailureScreenshotCleanups?.() ?? Promise.resolve();

      if (headedLanes.length > 0) {
        let visibleFiles = watchState.lastTestFiles;
        if (filterWatchTestPaths) {
          const visiblePaths = new Set(
            [
              ...filterWatchTestPaths(
                watchState.lastTestFiles.map((file) => file.testPath),
              ),
              ...(rerunPlan.decision.kind === 'rerun'
                ? rerunPlan.decision.testPaths
                : []),
            ].map(getTestPathKey),
          );
          visibleFiles = watchState.lastTestFiles.filter((file) =>
            visiblePaths.has(getTestPathKey(file.testPath)),
          );
        }
        await Promise.all(
          headedLanes.map((lane) => lane.syncFileSet(visibleFiles)),
        );
      }

      if (rerunPlan.decision.kind === 'idle') {
        void failureScreenshotCleanup.then(() => {
          logger.log(color.cyan(rerunPlan.decision.message));
          logWatchReady();
          if (rerunPlan.deferredTestPaths) {
            const deferredPaths = rerunPlan.deferredTestPaths;
            watchSignals.queueInvalidationAfter(
              Promise.resolve(),
              deferredPaths,
              undefined,
              (rawCycle) => recordPathsForAll(rawCycle, deferredPaths),
            );
          }
        });
        return;
      }

      void failureScreenshotCleanup.then(() => {
        logger.log(color.cyan(rerunPlan.decision.message));
      });
      const targetPaths =
        rerunPlan.decision.kind === 'empty' ? [] : rerunPlan.decision.testPaths;
      const { cycle } = await watchSignals.signalInvalidation(
        targetPaths,
        (rawCycle) => recordPathsForAll(rawCycle, targetPaths),
        updateSnapshot,
      );
      if (rerunPlan.deferredTestPaths) {
        const deferredPaths = rerunPlan.deferredTestPaths;
        watchSignals.queueInvalidationAfter(
          cycle,
          deferredPaths,
          undefined,
          (rawCycle) => recordPathsForAll(rawCycle, deferredPaths),
        );
      }
    } catch (error) {
      logWatchReady();
      throw error;
    }
  };

  // Serialized against itself: each per-project compiler fires its own
  // `onAfterDevCompile`, and two interleaved planning passes would race on
  // the drain-once affected set and the file-set commit.
  const dispatchRerunQueue = createSerialTaskQueue();
  watchSignals.setDispatchRerun((updateSnapshot, requestedTestPaths) =>
    dispatchRerunQueue.enqueue(() =>
      runDispatchRerunOnce(updateSnapshot, requestedTestPaths),
    ),
  );

  for (const lane of headedLanes) {
    lane.setUiRerunHandler(async (file, testNamePattern) => {
      const { cycle } = await watchSignals.signalInvalidation(
        [file.testPath],
        (rawCycle) =>
          recordPathForContainer(
            rawCycle,
            file.testPath,
            lane.containerId,
            testNamePattern,
          ),
        undefined,
        // Interrupt only the clicked container's queue so sibling headed and
        // headless lanes finish their in-flight work undisturbed.
        lane.containerId,
      );
      // Await the cycle THIS signal started — not whichever signal last wrote
      // the shared slot, which a concurrent rebuild trigger can overwrite
      // between the signal and the wait.
      await cycle;
    });
  }

  return {
    runCycle: async (testPaths, updateSnapshot, onSelected) => {
      const fatalCompileError = getFatalCompileError();
      if (fatalCompileError) {
        pendingCycleScopes.length = 0;
        return {
          ...buildRerunOutcome({
            rerunTestPaths: [],
            testTime: 0,
            rawCoverage: [],
            unhandledErrors: [fatalCompileError],
          }),
          failure: 'fatal',
        };
      }

      // Claim target lanes synchronously before the first await so concurrent
      // triggers landing while `onSelected` or execution is pending bind to
      // their own queued cycle instead of mutating this one.
      const {
        headlessPaths,
        headedPathsByContainer,
        testNamePatterns,
        selectedFiles,
        executedFileKeys,
      } = claimCycleTargets(testPaths);

      const runStartFailure = await onSelected?.(selectedFiles);
      if (runStartFailure) {
        fatalErrorRef.current = null;
        return buildRerunOutcome({
          rerunTestPaths: [],
          executedFileKeys: new Set(),
          testTime: 0,
          rawCoverage: [],
        });
      }

      const rerunStartTime = Date.now();
      fatalErrorRef.current = null;
      syncRuntimeConfig?.();
      await watchState.awaitFailureScreenshotCleanups?.();

      const laneTasks: Promise<unknown[]>[] = [];
      if (headlessLane && headlessPaths.length > 0) {
        laneTasks.push(headlessLane.runScope(headlessPaths, updateSnapshot));
      }
      for (const lane of headedLanes) {
        const lanePaths = headedPathsByContainer.get(lane.containerId)!;
        if (lanePaths.length > 0) {
          laneTasks.push(
            lane.runScope(
              lanePaths,
              updateSnapshot,
              testNamePatterns?.get(lane.containerId),
            ),
          );
        }
      }

      let rerunError: Error | undefined;
      const rawCoverage: unknown[] = [];
      const settled = await Promise.allSettled(laneTasks);
      for (const entry of settled) {
        if (entry.status === 'fulfilled') {
          rawCoverage.push(...entry.value);
        } else if (!rerunError) {
          rerunError = toError(entry.reason);
        }
      }

      const unhandledError = rerunError ?? fatalErrorRef.current ?? undefined;
      return buildRerunOutcome({
        rerunTestPaths: testPaths,
        executedFileKeys,
        testTime: Math.max(0, Date.now() - rerunStartTime),
        rawCoverage,
        unhandledErrors: unhandledError ? [unhandledError] : undefined,
      });
    },
    requestRerun: async (testPaths, updateSnapshot) => {
      if (testPaths && !hasMatchingTestPath(testPaths)) {
        const freshFiles = collectWatchTestFiles(await collectProjectEntries());
        if (!hasMatchingTestPath(testPaths, freshFiles)) {
          return;
        }
      }
      await watchSignals.runDispatchRerun(updateSnapshot, testPaths ?? 'all');
      await watchSignals.awaitSignalledCycle();
    },
  };
};
