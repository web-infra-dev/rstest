import { randomUUID } from 'node:crypto';
import {
  createDeferredPromise,
  type DeferredPromise,
  toError,
} from './hostPayloads';

/**
 * How long a minted run may go without a single message before it is settled
 * as never-booted. Must exceed the runner's CONFIG_WAIT_TIMEOUT_MS (30s,
 * client/runner.ts) so the runner gives up on its handshake first: a run that
 * trips this deadline is genuinely dead rather than merely slow.
 */
const RUN_BOOT_DEADLINE_MS = 45_000;

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
 *   `setTransportEpoch`, the boot deadline and the completion path can all
 *   fire for one run and only the first has effect.
 * - `admit` marks a run whose terminal message ("file-complete" / "fatal") is
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
  bootTimer: ReturnType<typeof setTimeout>;
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
    clearTimeout(record.bootTimer);
    if (error) {
      record.deferred.reject(error);
    } else {
      record.deferred.resolve();
    }
  };

  /**
   * Every sweep shares one rule: only OPEN runs are swept. A claimed run's
   * terminal message already arrived and its handler owns the outcome.
   */
  const sweepOpen = (
    match: (record: RunRecord) => boolean,
    error?: Error,
  ): void => {
    for (const record of runsById.values()) {
      if (record.phase === 'open' && match(record)) {
        settle(record, error);
      }
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
      sweepOpen((record) => record.testPath === testPath);

      const runId = randomUUID();
      const bootTimer = setTimeout(() => {
        const record = runsById.get(runId);
        if (record) {
          settle(
            record,
            new Error(
              `Headed run for ${testPath} produced no message within ${RUN_BOOT_DEADLINE_MS / 1000}s; its document never booted`,
            ),
          );
        }
      }, RUN_BOOT_DEADLINE_MS);
      bootTimer.unref?.();

      const record: RunRecord = {
        runId,
        testPath,
        epoch: transportEpoch,
        phase: 'open',
        deferred: createDeferredPromise<void>(),
        bootTimer,
      };
      runsById.set(runId, record);
      return { runId, settled: record.deferred.promise };
    },

    /**
     * The one liveness question, asked once per inbound message: may this
     * identity be processed? Any answer of `true` also proves the run's
     * document booted, which disarms the boot deadline.
     *
     * `terminal` marks a message that ends the run ("file-complete" /
     * "fatal"). It claims settlement for the caller's handler and must be
     * asked synchronously, before the handler's first await, so a file-set
     * commit racing the handler cannot settle the run a second time. A second
     * terminal for the same run is answered `false` — it is a duplicate.
     */
    admit(runId: string, terminal: boolean): boolean {
      const record = runsById.get(runId);
      if (!record) {
        return false;
      }
      clearTimeout(record.bootTimer);
      if (!terminal) {
        return true;
      }
      if (record.phase !== 'open') {
        return false;
      }
      record.phase = 'claimed';
      return true;
    },

    resolve(runId: string): void {
      const record = runsById.get(runId);
      if (record) {
        settle(record);
      }
    },

    reject(runId: string, error: unknown): void {
      const record = runsById.get(runId);
      if (record) {
        settle(record, toError(error));
      }
    },

    /**
     * The file-set commit's settlement obligation: close every open run whose
     * path left the committed set — the container is about to unmount those
     * frames, so their completions can never arrive (and if one is already in
     * transport, its runId is gone from the table and drops by rule).
     */
    retainPaths(paths: readonly string[]): void {
      const retained = new Set(paths);
      sweepOpen((record) => !retained.has(record.testPath));
    },

    /** Transport death: no completion can arrive for any open run. */
    rejectAll(error: Error): void {
      sweepOpen(() => true, error);
    },

    /**
     * A new transport attachment orphans every run leased under the previous
     * one, even when the old socket never fired `close` (its listeners are
     * detached before the event can). Runs minted from now on carry the new
     * epoch.
     */
    setTransportEpoch(epoch: number): void {
      transportEpoch = epoch;
      sweepOpen(
        (record) => record.epoch < epoch,
        new Error('Container transport was replaced before the run completed'),
      );
    },
  };
};
