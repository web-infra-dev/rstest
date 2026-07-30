import type { RsbuildInstance } from '@rsbuild/core';
import type { ProjectContext } from '../types';
import type { TraceEvent } from '../utils';
import {
  type BrowserRunPlan,
  createBrowserRunPlanner,
} from './browser/runPlanner';
import {
  createRunProjectPlanState,
  type RunProjectPlan,
  syncNodeProjects,
} from './projectPlan';
import { prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';
import { createSetupFileState, type SetupFileState } from './setupFileState';

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
 *
 * Three of these members are **live shared references, not snapshots**; every
 * consumer has to keep sharing the one object:
 * - `setupFileState` — the Rsbuild config hook refreshes it in place (the two
 *   record objects keep their identity) and `pluginEntryWatch` was handed those
 *   same records at boot, so `createRsbuildServer` must read the same state or it
 *   works from a set of setup files frozen before the hooks ran.
 * - `globTestSourceEntries` — closes over the plan state's entries cache, which
 *   every re-resolve *replaces*; a second plan state would hand the node side a
 *   cache that diverges from the plan the run was scoped by.
 * - the Rsbuild project array (planner-internal, deliberately not exposed) —
 *   `prepareRsbuild` re-reads it inside its config hook and `syncNodeProjects`
 *   splices it in place, so ownership stays here.
 */
export interface RunPlanner extends BrowserRunPlan {
  /** The resolved plan: browser + node runnable subsets and their entries. */
  getPlan(): RunProjectPlan;
  hasNodeTestsToRun(): boolean;
  /** A coverage-plugin load error captured while preparing Rsbuild, if any. */
  coveragePluginLoadError(): unknown;
  /** Re-glob every runnable node project's test entries as a flat path list. */
  globTestEntries(): Promise<string[]>;
  /** The node Rsbuild instance, with its config hooks already applied. */
  readonly rsbuildInstance: RsbuildInstance;
  readonly setupFileState: SetupFileState;
  globTestSourceEntries(name: string): Promise<Record<string, string>>;
}

export type CreateRunPlannerOptions = {
  browserProjects: ProjectContext[];
  nodeProjects: ProjectContext[];
  isWatchMode: boolean;
  /** Forwards the discovery boot's trace events into the run's trace buffer. */
  onTraceEvents?: (events: TraceEvent[]) => void;
};

export async function createRunPlanner(
  context: Rstest,
  {
    browserProjects,
    nodeProjects,
    isWatchMode,
    onTraceEvents,
  }: CreateRunPlannerOptions,
): Promise<RunPlanner> {
  const setupFileState = createSetupFileState();
  const projectPlanState = createRunProjectPlanState({
    context,
    isWatchMode,
  });
  const { globTestSourceEntries, resolveRunnableProjects } = projectPlanState;

  let coveragePluginLoadError: unknown;

  const getPlan = (): RunProjectPlan => projectPlanState.getPlan();

  const plan = await resolveRunnableProjects({ silentShardMessage: true });

  // The Rsbuild project set: the planned node subset, plus every node project the
  // plan left out — those still need an environment for their
  // `modifyRstestConfig` hooks to fire in, and a hook is allowed to add the test
  // files that put the project back in the plan. Assembled before
  // `prepareRsbuild`, which captures this exact array as `targetProjects` and
  // re-reads it inside its config hook; that is why `syncNodeProjects` splices it
  // in place instead of replacing it.
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
    onModifyRstestConfigApplied: async () => {
      const refreshed = await resolveRunnableProjects({
        strictEnvironmentComments: true,
      });
      syncNodeProjects(rsbuildProjects, refreshed.nodeProjectsToRun);
    },
    onRsbuildConfigResolved: projectPlanState.validateEnvironmentComments,
  });

  // Where the node `modifyRstestConfig` hooks actually fire. The guard is
  // unreachable while a zero-node run is routed away by the orchestrator's
  // browser-only fast path; it becomes the planner's own zero-node condition once
  // that path folds back in.
  if (nodeProjects.length) {
    await rsbuildInstance.initConfigs({ action: 'dev' });
  }

  // Re-resolve after browser-side `modifyRstestConfig` hooks changed project
  // configs (the discovery boot below can add test files to an otherwise-empty
  // browser project), keeping the Rsbuild project set in sync.
  const refreshPlan = async (): Promise<void> => {
    const refreshed = await resolveRunnableProjects({
      silentShardMessage: true,
      strictEnvironmentComments: true,
    });
    syncNodeProjects(rsbuildProjects, refreshed.nodeProjectsToRun);
  };

  // The browser half of the barrier. Destructured so the discovery step is spent
  // here and only the query half reaches the returned planner — a second caller
  // is what the once-only flags inside it could not survive.
  const { runConfigHookDiscovery, ...browserPlan } = createBrowserRunPlanner({
    context,
    getPlan,
    refreshPlan,
    browserProjects,
    nodeProjects,
    onTraceEvents,
  });
  await runConfigHookDiscovery();

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
    rsbuildInstance,
    setupFileState,
    globTestSourceEntries,
  };
}
