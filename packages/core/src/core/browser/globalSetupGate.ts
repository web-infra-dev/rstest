import type { FSWatcher } from 'chokidar';
import type { ExecutorCycleOutcome, InternalContext } from '../../types';
import { color, logger, toError } from '../../utils';
import { createChokidar } from '../../utils/watchFiles';
import type { TestPlanner } from '../planner';
import type { WatchCycleDriver, WatchTeardown } from '../watchSession';
import {
  type BrowserGlobalSetupStageResult,
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './globalSetupStage';
import type { BrowserTestExecutor } from './loader';

/**
 * Defers the browser launch until the projects' `globalSetup` succeeds, so a
 * failed setup is a retryable cycle instead of a dead session.
 *
 * It has to sit in front of the launch rather than inside the host: the setups'
 * env change-set is baked into the runtime at launch and the host has no
 * watcher — nor any session — before it. So every cycle up to the launch runs
 * the stage again, reports a failure as that cycle's outcome, and the gate
 * keeps the one trigger a pre-launch session can have: a watcher on the setup
 * files themselves.
 */
export const createBrowserSetupGate = ({
  context,
  planner,
  watchDriver,
  watchTeardown,
  executor,
  onSetupSucceeded,
}: {
  context: InternalContext;
  planner: TestPlanner;
  watchDriver: WatchCycleDriver;
  watchTeardown: WatchTeardown;
  executor: BrowserTestExecutor;
  /**
   * Called once a retried stage finally succeeds — never after a clean first
   * one. The setups write their env to `context.workerEnv`, which node workers
   * read at dispatch, so a node side that already ran a cycle during the failure
   * holds results from before those variables existed.
   */
  onSetupSucceeded?: () => void;
}): BrowserTestExecutor & {
  /**
   * Run the stage that gates the launch. Called where the launch ordering
   * demands it — before the node dev server starts, so a node cycle cannot be
   * dispatched without the setups' env.
   */
  runInitialStage: () => Promise<void>;
} => {
  let stageOutstanding = true;
  // The initial stage's failure, finalized by the first cycle rather than by a
  // second hand-written finalize at the call site.
  let pendingErrors: Error[] | undefined;
  // Accumulated across attempts: the stage skips projects that already
  // succeeded, so their env changes come back exactly once.
  const env: Record<string, string | undefined> = {};
  let setupWatcher: FSWatcher | undefined;

  const runStage = async (): Promise<BrowserGlobalSetupStageResult> => {
    const stage = await watchTeardown.track(
      runBrowserGlobalSetupStage(context, planner.getBrowserProjectsToRun(), {
        entriesCache: planner.getPlan().entriesCache,
        watch: true,
      }),
    );
    Object.assign(env, stage.env);
    stageOutstanding = stage.errors.length > 0;
    // A retry compiles whatever the fixed setup files now import, so the paths
    // that could fail next are not the ones the initial stage found.
    setupWatcher?.add(stage.setupPaths ?? []);
    return stage;
  };

  // One object for the whole session, `runInitialStage` included: the watch
  // driver keys settled cycles by executor identity, so the executor core drives
  // and the one `requestRerun` queues a cycle for must be the same value.
  const gate: BrowserTestExecutor & { runInitialStage: () => Promise<void> } = {
    ...executor,
    async runCycle(options) {
      if (executor.hasWatchSession()) {
        return executor.runCycle(options);
      }
      // A stage this cycle has to run is a retry: `runInitialStage` clears the
      // flag before any cycle starts unless its own stage failed. So a success
      // from here is a recovery, which the node side has to hear about.
      const isRetry = stageOutstanding && !pendingErrors;
      const errors =
        pendingErrors ?? (stageOutstanding ? (await runStage()).errors : []);
      pendingErrors = undefined;
      if (errors.length) {
        return globalSetupFailureOutcome(errors);
      }
      if (isRetry) {
        onSetupSucceeded?.();
      }
      let outcome: ExecutorCycleOutcome;
      try {
        outcome = await executor.runCycle({
          ...options,
          // This cycle is the launch, which runs every test file the projects
          // have, whatever scope the retry trigger resolved.
          mode: 'all',
          env: Object.keys(env).length ? env : undefined,
        });
      } catch (error) {
        if (executor.hasWatchSession()) {
          throw error;
        }
        // The launch itself failed — a missing provider, a taken port. The
        // driver only rejects startup on a *first* cycle, and a retry is never
        // that, so without this the session would sit open with no browser and
        // nothing left to retry from. Reported as a fatal outcome instead: the
        // same shape a browser compile failure uses, so the round finalizes and
        // then the session ends.
        const fatal = toError(error);
        return { ...globalSetupFailureOutcome([fatal]), fatal };
      }
      // A launch that came back without a session leaves the retry armed.
      if (executor.hasWatchSession()) {
        await setupWatcher?.close();
      }
      return outcome;
    },
    async requestRerun(testPaths) {
      if (executor.hasWatchSession()) {
        await executor.requestRerun(testPaths);
        return;
      }
      await watchDriver.runCycle(gate, { mode: 'all' });
    },
    async runInitialStage() {
      const { errors, setupPaths } = await runStage();
      if (!errors.length) {
        return;
      }
      pendingErrors = errors;
      setupWatcher = await createChokidar(setupPaths ?? [], context.rootPath, {
        ignoreInitial: true,
        ignorePermissionErrors: true,
        // Same reason `restart.ts` polls: `fs.watch` arms late, and the fix
        // saved right after the failure is exactly the edit that matters.
        usePolling: true,
        interval: 100,
      });
      const onSetupFileWritten = () => {
        // Nothing awaits this trigger, and the driver turns a later cycle's
        // executor rejection into an error outcome — so a rejection here is a
        // finalize that threw, reported rather than left to crash the session.
        void gate
          .requestRerun([])
          .catch((error) =>
            logger.error(color.red('Browser globalSetup retry failed:'), error),
          );
      };
      // An editor that saves atomically replaces the file rather than writing
      // through it, so the fix arrives as `unlink` + `add`. `unlink` alone is
      // not subscribed: the entry is gone, and the retry would only fail on a
      // missing file — the `add` that follows a replace is the real signal.
      setupWatcher.on('add', onSetupFileWritten);
      setupWatcher.on('change', onSetupFileWritten);
      watchTeardown.addCleanup(() => {
        void setupWatcher?.close();
      });
    },
  };

  return gate;
};
