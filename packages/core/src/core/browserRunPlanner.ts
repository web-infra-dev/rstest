import type { BrowserTestRunOptions, ProjectContext } from '../types';
import {
  isFilterInsideProject,
  isFuzzyBasenameFilter,
  type TraceEvent,
} from '../utils';
import {
  type BrowserExecutorRunOptions,
  runBrowserModeTests,
} from './browserLoader';
import type { NodeExecutor } from './executors/nodeExecutor';
import { getUserRstestConfigPluginProjects } from './modifyRstestConfig';
import type { Rstest } from './rstest';

/**
 * Browser-side planning for a mixed (node + browser) run: which browser
 * projects run, whether the config-hook discovery boot is needed, and the
 * option bags the browser executor/watch session are launched with. Keeps the
 * filter-classification and discovery detail out of the `runTests` orchestrator.
 */
export interface BrowserRunPlanner {
  /**
   * Boot the browser side once in files-only mode when the plan may depend on
   * browser `modifyRstestConfig` hooks (they only apply inside a browser
   * runtime boot and can add test files to an otherwise-empty project), then
   * re-resolve the node executor's plan. No-op when discovery is not needed.
   */
  runConfigHookDiscovery(): Promise<void>;
  hasBrowserTestsToRun(): boolean;
  getBrowserProjectsToRun(): ProjectContext[];
  /**
   * Options for the mixed non-watch browser executor construction. `filesOnly`
   * is owned by the discovery boot, never by a real run.
   */
  getExecutorRunOptions(
    projects: ProjectContext[],
  ): Omit<BrowserExecutorRunOptions, 'filesOnly'>;
  /** Options for the host-driven browser watch session (background or foreground). */
  getWatchRunOptions(projects: ProjectContext[]): BrowserTestRunOptions;
}

export function createBrowserRunPlanner({
  context,
  nodeExecutor,
  browserProjects,
  nodeProjects,
  onTraceEvents,
}: {
  context: Rstest;
  nodeExecutor: NodeExecutor;
  browserProjects: ProjectContext[];
  nodeProjects: ProjectContext[];
  onTraceEvents?: (events: TraceEvent[]) => void;
}): BrowserRunPlanner {
  const { rootPath } = context;
  const { shard } = context.normalizedConfig;

  const isFuzzyFilter = (filter: string) =>
    isFuzzyBasenameFilter(filter, context.fileFilterMode);

  const isInsideProject = (filter: string, project: ProjectContext) =>
    isFilterInsideProject(filter, project.rootPath, rootPath);

  const isBrowserProjectPathFilter = (filter: string) =>
    !isFuzzyFilter(filter) &&
    browserProjects.some((project) => isInsideProject(filter, project));

  const isNodeProjectPathFilter = (filter: string) =>
    !isFuzzyFilter(filter) &&
    nodeProjects.some((project) => isInsideProject(filter, project));

  const browserConfigHookProjects =
    getUserRstestConfigPluginProjects(browserProjects);
  // Keeps browser `modifyRstestConfig` hooks single-shot across the discovery
  // boot and the real run.
  const appliedModifyRstestConfigEnvironments = new Set<string>();
  let hasRunBrowserConfigHookDiscovery = false;

  const shouldRunBrowserDiscoveryFallback = () => {
    if (
      browserConfigHookProjects.length === 0 ||
      context.relatedResolutionEmpty ||
      hasRunBrowserConfigHookDiscovery
    ) {
      return false;
    }

    if (!context.fileFilters?.length) {
      return true;
    }

    return context.fileFilters.some(
      (filter) =>
        isFuzzyFilter(filter) ||
        browserConfigHookProjects.some((project) =>
          isInsideProject(filter, project),
        ) ||
        (!isBrowserProjectPathFilter(filter) &&
          !isNodeProjectPathFilter(filter)),
    );
  };

  const shouldAllowEmptyBrowserFallback = () =>
    shouldRunBrowserDiscoveryFallback() &&
    nodeExecutor.hasNodeTestsToRun() &&
    !context.fileFilters?.some(isBrowserProjectPathFilter);

  const getBrowserProjectsForDiscovery = () => {
    if (!context.fileFilters?.length) {
      return browserConfigHookProjects;
    }

    if (context.fileFilters.some(isFuzzyFilter)) {
      return browserConfigHookProjects;
    }

    const matchedProjects = browserConfigHookProjects.filter((project) =>
      context.fileFilters?.some((filter) => isInsideProject(filter, project)),
    );
    if (matchedProjects.length > 0) {
      return matchedProjects;
    }

    return context.fileFilters.some(
      (filter) =>
        !isBrowserProjectPathFilter(filter) && !isNodeProjectPathFilter(filter),
    )
      ? browserConfigHookProjects
      : [];
  };

  const getBrowserProjectsToRun = () => {
    const currentPlan = nodeExecutor.getPlan();
    if (currentPlan.browserProjectsToRun.length > 0) {
      return currentPlan.browserProjectsToRun;
    }

    return getBrowserProjectsForDiscovery();
  };

  const getBrowserShardedEntries = (
    projects: ProjectContext[],
  ): BrowserTestRunOptions['shardedEntries'] => {
    if (!shard) {
      return undefined;
    }
    const currentPlan = nodeExecutor.getPlan();
    const browserEntries = new Map<
      string,
      { entries: Record<string, string> }
    >();
    for (const project of projects) {
      const entries = currentPlan.entriesCache.get(project.environmentName);
      if (entries) {
        browserEntries.set(project.environmentName, entries);
      }
    }
    return browserEntries;
  };

  // In a sharded mixed run the node side already resolved the browser shard
  // slice, so the host must not re-shard on a config hook refresh.
  const freezeShardedEntries = Boolean(shard && nodeProjects.length);

  const getExecutorRunOptions = (
    projects: ProjectContext[],
  ): Omit<BrowserExecutorRunOptions, 'filesOnly'> => ({
    shardedEntries: getBrowserShardedEntries(projects),
    freezeShardedEntries,
    allowEmptyRun: shouldAllowEmptyBrowserFallback(),
    appliedModifyRstestConfigEnvironments,
  });

  return {
    async runConfigHookDiscovery() {
      if (nodeProjects.length === 0 || !shouldRunBrowserDiscoveryFallback()) {
        return;
      }
      const browserProjectsForDiscovery = getBrowserProjectsForDiscovery();
      const discoveryResult = await runBrowserModeTests(
        context,
        browserProjectsForDiscovery,
        {
          shardedEntries: getBrowserShardedEntries(browserProjectsForDiscovery),
          filesOnly: true,
          allowEmptyRun: true,
          appliedModifyRstestConfigEnvironments,
          onTraceEvents,
        },
      );
      if (discoveryResult?.hasFailure) {
        await discoveryResult.close?.();
        throw (
          discoveryResult.unhandledErrors?.[0] ??
          new Error('Failed to initialize Browser Mode discovery.')
        );
      }
      await discoveryResult?.close?.();
      hasRunBrowserConfigHookDiscovery = true;
      await nodeExecutor.refreshPlan();
    },
    hasBrowserTestsToRun: () =>
      nodeExecutor.hasBrowserTestsToRun() ||
      shouldRunBrowserDiscoveryFallback(),
    getBrowserProjectsToRun,
    getExecutorRunOptions,
    // The watch session takes the executor bag plus the two watch-only fields:
    // an empty initial set must keep the session alive, and trace events are
    // forwarded from the host instead of flowing through `runCycle`.
    getWatchRunOptions: (projects) => ({
      ...getExecutorRunOptions(projects),
      allowEmptyWatchRun: context.relatedResolutionEmpty,
      onTraceEvents,
    }),
  };
}
