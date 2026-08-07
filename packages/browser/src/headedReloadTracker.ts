import { logger } from '@rstest/core/internal/browser';
import { createDeferredPromise, type DeferredPromise } from './hostPayloads';

type PendingHeadedReload = {
  runId: string;
  deferred: DeferredPromise<void>;
  /**
   * Set the moment this reload's file-complete arrives, before its handler is
   * awaited: from then on the handler owns the settlement, and `reconcile`
   * must keep its hands off. Resolving a claimed pending early would release
   * the cycle while reporters are still consuming the result, letting core
   * reach `onTestRunEnd` before `onTestFileResult` returns.
   */
  completionClaimed: boolean;
};

export type HeadedReloadTracker = {
  register: (testPath: string, runId: string) => Promise<void>;
  resolve: (testPath: string, runId?: string) => void;
  reject: (testPath: string, error: Error, runId?: string) => void;
  rejectAll: (error: Error) => void;
  claimCompletion: (testPath: string, runId?: string) => void;
  reconcile: () => void;
};

/**
 * Owns the lifecycle of pending headed reloads — the promises a headed cycle
 * is made of. A headed cycle ends only once every reload it issued has
 * settled, so an unsettled pending wedges its cycle and every cycle core has
 * queued behind it, with no error and no disconnect to show for it.
 *
 * Each settlement normally arrives as an event from the container
 * (file-complete → {@link HeadedReloadTracker.resolve}, fatal/disconnect →
 * {@link HeadedReloadTracker.rejectAll}). Any host action that makes such an
 * event impossible must settle the pending itself; the tracker holds that
 * obligation at both ends of the map:
 *
 * - Entry — {@link HeadedReloadTracker.register} refuses a pending for a file
 *   `isLive` no longer knows. The reload ack's round trip is an await, so a
 *   file-set commit can land inside it; registration is the last point the
 *   set can be consulted without a race, because everything from the check to
 *   the map write is synchronous. Nothing to wait for, so it resolves.
 * - Exit — {@link HeadedReloadTracker.reconcile} settles every unclaimed
 *   pending whose file has left the live set: dropping a file unmounts the
 *   iframe its runner was navigating, so no `load` fires and no file-complete
 *   can follow. Keyed on `isLive` rather than the planner's deleted-path
 *   diff, which is a second derivation of the same fact and can drift from
 *   whatever last assigned the file set. Resolved rather than rejected: the
 *   file is gone and its results are pruned alongside, so the reload has
 *   nothing left to produce.
 *
 * Every path-scoped operation takes an optional `runId` guard: a mismatch
 * belongs to a superseded run, whose events settle (and claim) nothing.
 */
export const createHeadedReloadTracker = (
  isLive: (testPath: string) => boolean,
): HeadedReloadTracker => {
  const pendingReloads = new Map<string, PendingHeadedReload>();

  const getMatchingPending = (
    testPath: string,
    runId?: string,
  ): PendingHeadedReload | undefined => {
    const pending = pendingReloads.get(testPath);
    if (!pending) {
      return undefined;
    }
    if (runId && pending.runId !== runId) {
      return undefined;
    }
    return pending;
  };

  return {
    register(testPath, runId) {
      if (!isLive(testPath)) {
        logger.debug(
          `[Browser UI] Dropping reload registration for removed test file: ${testPath}`,
        );
        return Promise.resolve();
      }

      const previousPending = pendingReloads.get(testPath);
      if (previousPending) {
        previousPending.deferred.reject(
          new Error(
            `Reload for "${testPath}" was superseded by a newer request.`,
          ),
        );
        pendingReloads.delete(testPath);
      }

      const deferred = createDeferredPromise<void>();
      pendingReloads.set(testPath, {
        runId,
        deferred,
        completionClaimed: false,
      });

      return deferred.promise;
    },
    resolve(testPath, runId) {
      const pending = getMatchingPending(testPath, runId);
      if (!pending) {
        if (pendingReloads.has(testPath)) {
          logger.debug(
            `[Browser UI] Ignoring stale file-complete for ${testPath}. current=${pendingReloads.get(testPath)?.runId}, incoming=${runId}`,
          );
        }
        return;
      }
      pendingReloads.delete(testPath);
      pending.deferred.resolve();
    },
    reject(testPath, error, runId) {
      const pending = getMatchingPending(testPath, runId);
      if (!pending) {
        return;
      }
      pendingReloads.delete(testPath);
      pending.deferred.reject(error);
    },
    rejectAll(error) {
      for (const [testPath, pending] of pendingReloads) {
        pendingReloads.delete(testPath);
        pending.deferred.reject(error);
      }
    },
    claimCompletion(testPath, runId) {
      const pending = getMatchingPending(testPath, runId);
      if (pending) {
        pending.completionClaimed = true;
      }
    },
    reconcile() {
      for (const [testPath, pending] of pendingReloads) {
        if (!isLive(testPath) && !pending.completionClaimed) {
          pendingReloads.delete(testPath);
          pending.deferred.resolve();
        }
      }
    },
  };
};
