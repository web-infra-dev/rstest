import type { RsbuildInstance } from '@rsbuild/core';
import type { ProjectContext } from '../types';
import type { TraceEvent } from '../utils';
import {
  type BrowserRunPlan,
  createBrowserRunPlanner,
} from './browser/runPlanner';
import {
  createProjectPlanState,
  type ProjectPlan,
  syncNodeProjects,
} from './projectPlan';
import { prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';
import { createSetupFileState, type SetupFileState } from './setupFileState';

/**
 * The node build machinery a `NodeExecutor` is constructed from, brought up by
 * the planner. `undefined` when the run has no node projects at all — that is
 * the cold-start gate expressed as a planner condition: booting the Rsbuild
 * instance is the cost a pure-browser run must never pay, so the planner skips
 * it and the orchestrator simply builds no node executor.
 *
 * Two of these members are **live shared references, not snapshots**; every
 * consumer has to keep sharing the one object:
 * - `setupFileState` — the Rsbuild config hook refreshes it in place (the two
 *   record objects keep their identity) and `pluginEntryWatch` was handed those
 *   same records at boot, so `createRsbuildServer` must read the same state or it
 *   works from a set of setup files frozen before the hooks ran.
 * - `globTestSourceEntries` — closes over the plan state's entries cache, which
 *   every re-resolve *replaces*; a second plan state would hand the node side a
 *   cache that diverges from the plan the run was scoped by.
 *
 * The third such reference, the Rsbuild project array, stays planner-internal on
 * purpose: `prepareRsbuild` re-reads it inside its config hook and
 * `syncNodeProjects` splices it in place, so ownership never leaves here.
 */
export type NodeBuild = {
  /** Already prepared, config-hooked, and `initConfigs`-ed by the planner. */
  readonly rsbuildInstance: RsbuildInstance;
  readonly setupFileState: SetupFileState;
  globTestSourceEntries(name: string): Promise<Record<string, string>>;
};

/**
 * Core's answer to "what does this run have to do": which projects on each side
 * have tests to run, and the node build machinery an executor is constructed
 * from. Planning lives here rather than inside the node executor so the question
 * "which executors does this run even need" is answerable before any of them
 * exists. Both sides answer from here — the browser-side classification lives in
 * `core/browser/runPlanner.ts` but is owned and driven from inside this call, so
 * the orchestrator holds one planner rather than a pair to keep in step.
 *
 * Resolving is the run's init barrier — the node `modifyRstestConfig` hooks fire,
 * the browser's fire too when the plan may depend on them (inside the files-only
 * discovery boot), and the plan is read while the planner is being built, so a
 * resolved planner is the only kind there is and no executor can be constructed
 * against a plan that is still moving. The browser side's once-only state (which
 * environments already applied their hooks, whether the discovery boot has run)
 * is settled by the time this returns and has no re-entry point afterwards, so
 * nothing can catch it half-applied.
 */
export interface TestPlanner extends BrowserRunPlan {
  /** The resolved plan: browser + node runnable subsets and their entries. */
  getPlan(): ProjectPlan;
  hasNodeTestsToRun(): boolean;
  /** A coverage-plugin load error captured while preparing Rsbuild, if any. */
  coveragePluginLoadError(): unknown;
  /** Re-glob every runnable node project's test entries as a flat path list. */
  globTestEntries(): Promise<string[]>;
  /** The node build, or `undefined` for a zero-node run — see {@link NodeBuild}. */
  readonly nodeBuild: NodeBuild | undefined;
}

export type CreateTestPlannerOptions = {
  browserProjects: ProjectContext[];
  nodeProjects: ProjectContext[];
  isWatchMode: boolean;
  /** Forwards the discovery boot's trace events into the run's trace buffer. */
  onTraceEvents?: (events: TraceEvent[]) => void;
};

export async function createTestPlanner(
  context: Rstest,
  {
    browserProjects,
    nodeProjects,
    isWatchMode,
    onTraceEvents,
  }: CreateTestPlannerOptions,
): Promise<TestPlanner> {
  const projectPlanState = createProjectPlanState({
    context,
    isWatchMode,
  });
  const { globTestSourceEntries, resolveRunnableProjects } = projectPlanState;

  let coveragePluginLoadError: unknown;

  const getPlan = (): ProjectPlan => projectPlanState.getPlan();

  const plan = await resolveRunnableProjects();

  // The Rsbuild project set: the planned node subset, plus every node project the
  // plan left out — those still need an environment for their
  // `modifyRstestConfig` hooks to fire in, and a hook is allowed to add the test
  // files that put the project back in the plan. Assembled before
  // `prepareRsbuild`, which captures this exact array as `targetProjects` and
  // re-reads it inside its config hook; that is why `syncNodeProjects` splices it
  // in place instead of replacing it. Empty — and spliced to empty forever — on a
  // zero-node run, which never builds the node side at all.
  const plannedNodeSourceNames = new Set(
    plan.nodeProjectsToRun.map(
      (project) =>
        project._environmentGroup?.sourceEnvironmentName ??
        project.environmentName,
    ),
  );
  const rsbuildProjects: ProjectContext[] = [
    ...plan.nodeProjectsToRun,
    ...nodeProjects.filter(
      (project) => !plannedNodeSourceNames.has(project.environmentName),
    ),
  ];

  /**
   * The planner's one mutation path: re-resolve after a `modifyRstestConfig`
   * hook changed project configs, then splice the result back into
   * `rsbuildProjects` in place, for the reason given above.
   */
  const resyncPlan = async (): Promise<void> => {
    const refreshed = await resolveRunnableProjects({
      strictEnvironmentComments: true,
    });
    syncNodeProjects(rsbuildProjects, refreshed.nodeProjectsToRun);
  };

  const buildNodeSide = async (): Promise<NodeBuild> => {
    const setupFileState = createSetupFileState();
    context.projects = [...browserProjects, ...rsbuildProjects];

    const rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries,
      setupFileState,
      targetProjects: rsbuildProjects,
      onCoveragePluginLoadError: (error) => {
        coveragePluginLoadError = error;
      },
      getSetupFileProjects: () => ({
        setupProjects: projectPlanState.getPlan().nodeProjectsToRun,
        globalSetupProjects: context.projects,
      }),
      onModifyRstestConfigApplied: () => resyncPlan(),
      onRsbuildConfigResolved: projectPlanState.validateEnvironmentComments,
    });

    // Where the node `modifyRstestConfig` hooks actually fire.
    await rsbuildInstance.initConfigs({ action: 'dev' });

    return { rsbuildInstance, setupFileState, globTestSourceEntries };
  };

  // The cold-start gate, as a planner condition rather than an orchestrator
  // branch: a run with no node projects has no environment for the Rsbuild
  // instance to hold and no node `modifyRstestConfig` hook to fire, so the whole
  // node build — `prepareRsbuild` and the `initConfigs` that triggers those
  // hooks — is skipped and the run stays browser-only from here down.
  const nodeBuild = nodeProjects.length ? await buildNodeSide() : undefined;

  // The browser half of the barrier. Destructured so the discovery and
  // validation steps are spent here and only the query half reaches the
  // returned planner — a second caller is what the once-only flags inside it
  // could not survive.
  const {
    runConfigHookDiscovery,
    ensureBrowserConfigValidated,
    ...browserPlan
  } = createBrowserRunPlanner({
    context,
    getPlan,
    refreshPlan: resyncPlan,
    browserProjects,
    nodeProjects,
    onTraceEvents,
  });
  await runConfigHookDiscovery();
  // An invalid browser config must fail the command even when the plan left no
  // browser test to boot a validating runtime for (e.g. a shard slice that
  // emptied the browser side).
  await ensureBrowserConfigValidated();

  // The one shard-banner print of the whole process, placed after the barrier
  // so the counts are the final plan's — every earlier resolve (pre-hook,
  // post-hook, post-discovery) only recorded them.
  projectPlanState.announceShardSlice();

  const globTestEntries = async (): Promise<string[]> => {
    const projects = getPlan().nodeProjectsToRun;
    const perProject = await Promise.all(
      projects.map((project) => globTestSourceEntries(project.environmentName)),
    );
    return perProject.reduce<string[]>(
      (acc, entries) => acc.concat(...Object.values(entries)),
      [],
    );
  };

  return {
    ...browserPlan,
    getPlan,
    hasNodeTestsToRun: () => getPlan().nodeProjectsToRun.length > 0,
    coveragePluginLoadError: () => coveragePluginLoadError,
    globTestEntries,
    nodeBuild,
  };
}
