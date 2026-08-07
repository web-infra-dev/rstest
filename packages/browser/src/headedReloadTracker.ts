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
  isObsolete: (testPath: string, runId?: string) => boolean;
};

/**
 * Owns the lifecycle of pending headed reloads — the promises a headed cycle
 * is made of, and with them the settlement contract `packages/browser/AGENTS.md`
 * states: every pending must be settled by exactly one owner.
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
 *
 * Settling a run as obsolete leaves a tombstone, because its completion can
 * already be in transport: the iframe posted file-complete, the host just has
 * not dispatched it yet, so there is nothing to claim. Without the tombstone
 * that arrival would be processed as live — reinserting the just-pruned
 * result and firing `onTestFileResult` after the cycle's `onTestRunEnd`.
 * {@link HeadedReloadTracker.isObsolete} is how the completion callback tells
 * such an arrival from a real one; tombstones are per (path, runId) and never
 * expire, since an even later arrival is just as dead.
 */
export const createHeadedReloadTracker = (
  isLive: (testPath: string) => boolean,
): HeadedReloadTracker => {
  const pendingReloads = new Map<string, PendingHeadedReload>();
  const obsoleteRunIds = new Map<string, Set<string>>();

  const markObsolete = (testPath: string, runId: string): void => {
    const runIds = obsoleteRunIds.get(testPath) ?? new Set<string>();
    runIds.add(runId);
    obsoleteRunIds.set(testPath, runIds);
  };

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
        // The reload was already sent (the ack carried this runId), so its
        // completion may still arrive — tombstone it like a reconciled one.
        markObsolete(testPath, runId);
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
      const pending = pendingReloads.get(testPath);
      if (!pending) {
        return;
      }
      if (runId && pending.runId !== runId) {
        logger.debug(
          `[Browser UI] Ignoring stale file-complete for ${testPath}. current=${pending.runId}, incoming=${runId}`,
        );
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
          markObsolete(testPath, pending.runId);
          pendingReloads.delete(testPath);
          pending.deferred.resolve();
        }
      }
    },
    isObsolete(testPath, runId) {
      // An arrival without a runId cannot be matched to a settled run; treat
      // it as live rather than swallow a real completion.
      if (!runId) {
        return false;
      }
      return obsoleteRunIds.get(testPath)?.has(runId) ?? false;
    },
  };
};
