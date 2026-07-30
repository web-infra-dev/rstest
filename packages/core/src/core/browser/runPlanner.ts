import type { BrowserTestRunOptions, ProjectContext } from '../../types';
import {
  isFilterInsideProject,
  isFuzzyBasenameFilter,
  type TraceEvent,
} from '../../utils';
import { type BrowserExecutorRunOptions, runBrowserDiscovery } from './loader';
import { getUserRstestConfigPluginProjects } from '../modifyRstestConfig';
import type { RunProjectPlan } from '../projectPlan';
import type { Rstest } from '../rstest';

/**
 * The browser-side questions a resolved run plan can answer: which browser
 * projects run, and the option bags the browser executor/watch session are
 * launched with. `RunPlanner` re-exposes exactly this, so the orchestrator asks
 * one object and the filter-classification detail stays under `core/browser/`.
 */
export interface BrowserRunPlan {
  hasBrowserTestsToRun(): boolean;
  getBrowserProjectsToRun(): ProjectContext[];
  /**
   * Whether the discovery boot ran, which means the browser executor was loaded
   * and the browser config validated along with it. The empty-run branch asks
   * because it validates directly — it is the one exit that may not load an
   * executor of its own, and validating a second time reprints every
   * unsupported-option warning (`reportUnsupportedBrowserOptions` has no
   * cross-call guard).
   */
  hasValidatedBrowserConfig(): boolean;
  /**
   * Options for the mixed non-watch browser executor construction. `filesOnly`
   * is owned by the discovery boot, never by a real run.
   */
  getExecutorRunOptions(
    projects: ProjectContext[],
  ): Omit<BrowserExecutorRunOptions, 'filesOnly'>;
}

interface BrowserRunPlanner extends BrowserRunPlan {
  /**
   * Boot the browser side once in files-only mode when the plan may depend on
   * browser `modifyRstestConfig` hooks (they only apply inside a browser
   * runtime boot and can add test files to an otherwise-empty project), then
   * re-resolve the run plan. No-op when discovery is not needed.
   *
   * `createRunPlanner` is the only caller and drives it while it is still
   * building, which is what keeps the once-only state below — the applied-hook
   * environment set and the discovery-ran flag — from ever being observed
   * half-applied: by the time anything holds a `RunPlanner`, discovery has
   * either finished or been declined.
   */
  runConfigHookDiscovery(): Promise<void>;
}

export function createBrowserRunPlanner({
  context,
  getPlan,
  refreshPlan,
  browserProjects,
  nodeProjects,
  onTraceEvents,
}: {
  context: Rstest;
  getPlan: () => RunProjectPlan;
  /** Re-resolve after the discovery boot's hooks changed project configs. */
  refreshPlan: () => Promise<void>;
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
    getPlan().nodeProjectsToRun.length > 0 &&
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
    const currentPlan = getPlan();
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
    const currentPlan = getPlan();
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

  // In a sharded mixed run the plan already resolved the browser shard slice, so
  // the host must not re-shard on a config hook refresh.
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
      // Deliberately not gated on having node projects. It used to be, back when
      // a zero-node run took a separate assembly that launched every browser
      // project — hooks fired at launch, so discovery had nothing to add. That
      // assembly is gone: every run now launches `getBrowserProjectsToRun()`,
      // which a project with no files on disk is resolved out of before its hook
      // can put any there. Discovery is the only thing that fires those hooks in
      // time, so a zero-node run needs the boot exactly as much as a mixed one.
      if (!shouldRunBrowserDiscoveryFallback()) {
        return;
      }
      const browserProjectsForDiscovery = getBrowserProjectsForDiscovery();
      const discoveryResult = await runBrowserDiscovery(
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
      await refreshPlan();
    },
    hasBrowserTestsToRun: () =>
      getPlan().browserProjectsToRun.length > 0 ||
      shouldRunBrowserDiscoveryFallback(),
    hasValidatedBrowserConfig: () => hasRunBrowserConfigHookDiscovery,
    getBrowserProjectsToRun,
    getExecutorRunOptions,
  };
}
