import { randomUUID } from 'node:crypto';
import {
  createDeferredPromise,
  type DeferredPromise,
  toError,
} from './hostPayloads';

/**
 * The single owner of every headed run's identity and settlement.
 *
 * Ownership model (see packages/browser/AGENTS.md): the host MINTS a run's
 * identity here, synchronously, before the reload RPC leaves the process — so
 * there is no window in which a run exists on the wire but not in this table.
 * The container confers that identity on whatever document boots into the
 * frame, and the document stamps it on every message. Inbound acceptance is
 * therefore one question — is this runId in the table? — with no path-keyed
 * matching, no tombstones, and no fallback identities:
 *
 * - Unknown runId ⇒ drop. Sound because minting precedes the container's
 *   grant, which precedes any document boot: every legitimate message's runId
 *   is in the table unless its run already finished, and a finished run's
 *   late messages (a completion already in transport when the run was closed,
 *   an HMR-rerun of an old document) are exactly the ones that must not be
 *   processed.
 * - Settling is exactly-once by construction: every settler funnels through
 *   one guarded map-delete, so `retainPaths`, `reject`, `rejectAll`,
 *   `setTransportEpoch` and the completion path can all fire for one run and
 *   only the first has effect.
 * - `claim` marks a run whose terminal message ("file-complete" / "fatal") is
 *   being handled: from that point the handler owns settlement, and the
 *   sweepers (`retainPaths`, `rejectAll`, `setTransportEpoch`) leave the run
 *   alone — its outcome is the handler's truthful one, not a guess.
 */
type RunPhase = 'open' | 'claimed';

type RunRecord = {
  runId: string;
  testPath: string;
  epoch: number;
  phase: RunPhase;
  deferred: DeferredPromise<void>;
};

export type HeadedRunRegistry = ReturnType<typeof createHeadedRunRegistry>;

export const createHeadedRunRegistry = () => {
  const runsById = new Map<string, RunRecord>();
  let transportEpoch = 0;

  const settle = (record: RunRecord, error?: Error): void => {
    // The map delete is the exactly-once gate: a record can be settled by at
    // most one caller, whichever reaches it first.
    if (!runsById.delete(record.runId)) {
      return;
    }
    if (error) {
      record.deferred.reject(error);
    } else {
      record.deferred.resolve();
    }
  };

  return {
    /**
     * Allocate a run and own its deferred, synchronously — the caller sends
     * the reload RPC only after this returns, so no file-set commit or
     * inbound message can land between "the run exists" and "the table knows
     * it" (the ack-window class of race cannot be constructed).
     */
    mint(testPath: string): { runId: string; settled: Promise<void> } {
      // A predecessor for the same path can only still be open if its cycle
      // was torn out from under it; close it as obsolete rather than leaking
      // it. A claimed predecessor is left to its handler.
      for (const record of runsById.values()) {
        if (record.testPath === testPath && record.phase === 'open') {
          settle(record);
        }
      }
      const runId = randomUUID();
      const record: RunRecord = {
        runId,
        testPath,
        epoch: transportEpoch,
        phase: 'open',
        deferred: createDeferredPromise<void>(),
      };
      runsById.set(runId, record);
      return { runId, settled: record.deferred.promise };
    },

    /** Is this identity a live (open or claimed) run? */
    has(runId: string): boolean {
      return runsById.has(runId);
    },

    /**
     * Take ownership of a run's settlement for its terminal message handler.
     * Must be called synchronously before the handler's first await. Returns
     * false when the run is absent or already claimed — the message is stale
     * (or a duplicate terminal) and must be dropped.
     */
    claim(runId: string): boolean {
      const record = runsById.get(runId);
      if (!record || record.phase !== 'open') {
        return false;
      }
      record.phase = 'claimed';
      return true;
    },

    /** Settle a run as completed. */
    resolve(runId: string): void {
      const record = runsById.get(runId);
      if (record) {
        settle(record);
      }
    },

    /** Settle a run as failed. */
    reject(runId: string, error: unknown): void {
      const record = runsById.get(runId);
      if (record) {
        settle(record, toError(error));
      }
    },

    /**
     * The file-set commit's settlement obligation: close every OPEN run whose
     * path left the committed set — the container is about to unmount those
     * frames, so their completions can never arrive (and if one is already in
     * transport, its runId is gone from the table and drops by rule). Claimed
     * runs are spared: their completion DID arrive and its handler owns them.
     */
    retainPaths(paths: readonly string[]): void {
      const retained = new Set(paths);
      for (const record of runsById.values()) {
        if (record.phase === 'open' && !retained.has(record.testPath)) {
          settle(record);
        }
      }
    },

    /**
     * Transport death: no completion can arrive for any open run. Claimed
     * runs are spared — their handlers run host-side and settle truthfully.
     */
    rejectAll(error: Error): void {
      for (const record of runsById.values()) {
        if (record.phase === 'open') {
          settle(record, error);
        }
      }
    },

    /**
     * A new transport attachment orphans every run leased under the previous
     * one, even when the old socket never fired `close` (its listeners are
     * detached before the event can). Runs minted from now on carry the new
     * epoch.
     */
    setTransportEpoch(epoch: number): void {
      transportEpoch = epoch;
      for (const record of runsById.values()) {
        if (record.phase === 'open' && record.epoch < epoch) {
          settle(
            record,
            new Error(
              'Container transport was replaced before the run completed',
            ),
          );
        }
      }
    },
  };
};
