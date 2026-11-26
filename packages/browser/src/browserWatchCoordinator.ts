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
import type { BrowserProjectRuntime } from './protocol';
import {
  type BrowserWatchSession,
  expandToRows,
  groupRowsByProject,
  type HeadedLaneResult,
  type HeadlessLaneResult,
} from './schedulerSeam';
import { createSerialTaskQueue } from './serialTaskQueue';
import { commitWatchFileSetUpdate, planWatchRerun } from './watchRerunPlanner';
import type { RequestedTestPaths, WatchSignals } from './watchSignals';

export type BuildRerunOutcome = (options: {
  rerunTestPaths: string[];
  executedFileKeys?: ReadonlySet<string>;
  testTime: number;
  rawCoverage: unknown[];
  unhandledErrors?: Error[];
}) => ExecutorCycleOutcome;

export type BrowserWatchCoordinatorDeps = {
  watchState: BrowserRuntime['watchState'];
  watchSignals: WatchSignals;
  headlessLane?: HeadlessLaneResult;
  headlessRows: readonly BrowserProjectRuntime[];
  headedLanes: readonly HeadedLaneResult[];
  collectProjectEntries: () => Promise<
    Parameters<typeof planWatchRerun>[0]['projectEntries']
  >;
  logWatchReady: () => void;
  hasMatchingTestPath: (testPaths: string[]) => boolean;
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
  logWatchReady,
  hasMatchingTestPath,
  getFatalCompileError,
  fatalErrorRef,
  buildRerunOutcome,
}: BrowserWatchCoordinatorDeps): BrowserWatchSession => {
  const headlessRowsByProject = groupRowsByProject(headlessRows);

  // Per-path lane target claimed synchronously when a trigger signals core:
  // `'all'` means every lane owning the path runs (file edit / CLI shortcut);
  // a `Set<containerId>` scopes execution and reporting strictly to the headed
  // container(s) whose UI button requested the rerun.
  const pendingPathTargets = new Map<string, Set<string> | 'all'>();

  const markPathsForAll = (paths: readonly string[]): void => {
    for (const testPath of paths) {
      pendingPathTargets.set(getTestPathKey(testPath), 'all');
    }
  };

  const markPathForContainer = (
    testPath: string,
    containerId: string,
  ): void => {
    const key = getTestPathKey(testPath);
    const existing = pendingPathTargets.get(key);
    if (existing === 'all') {
      return;
    }
    if (existing) {
      existing.add(containerId);
      return;
    }
    pendingPathTargets.set(key, new Set([containerId]));
  };

  const claimCycleTargets = (testPaths: string[]) => {
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

      const target = pendingPathTargets.get(key) ?? 'all';
      pendingPathTargets.delete(key);

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
      });

      commitWatchFileSetUpdate(rerunPlan.fileSetUpdate, watchState);
      watchState.removeFailureScreenshots?.(
        rerunPlan.fileSetUpdate?.deletedTestFiles ?? [],
      );
      const failureScreenshotCleanup =
        watchState.awaitFailureScreenshotCleanups?.() ?? Promise.resolve();

      if (rerunPlan.fileSetUpdate && headedLanes.length > 0) {
        await Promise.all(
          headedLanes.map((lane) =>
            lane.syncFileSet(rerunPlan.fileSetUpdate!.currentTestFiles),
          ),
        );
      }

      if (rerunPlan.decision.kind === 'idle') {
        void failureScreenshotCleanup.then(() => {
          logger.log(color.cyan(rerunPlan.decision.message));
          logWatchReady();
          if (rerunPlan.deferredTestPaths) {
            watchSignals.queueInvalidationAfter(
              Promise.resolve(),
              rerunPlan.deferredTestPaths,
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
        () => markPathsForAll(targetPaths),
        updateSnapshot,
      );
      if (rerunPlan.deferredTestPaths) {
        watchSignals.queueInvalidationAfter(cycle, rerunPlan.deferredTestPaths);
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
        () => {
          markPathForContainer(file.testPath, lane.containerId);
          lane.setPendingTestNamePattern(file.testPath, testNamePattern);
        },
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
      await watchState.awaitFailureScreenshotCleanups?.();

      const laneTasks: Promise<unknown[]>[] = [];
      if (headlessLane && headlessPaths.length > 0) {
        laneTasks.push(headlessLane.runScope(headlessPaths, updateSnapshot));
      }
      for (const lane of headedLanes) {
        const lanePaths = headedPathsByContainer.get(lane.containerId)!;
        if (lanePaths.length > 0) {
          laneTasks.push(lane.runScope(lanePaths, updateSnapshot));
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
        return;
      }
      await watchSignals.runDispatchRerun(updateSnapshot, testPaths ?? 'all');
      await watchSignals.awaitSignalledCycle();
    },
  };
};
