import type { BrowserTestRunOptions, ProjectContext } from '../../types';
import {
  isFilterInsideProject,
  isFuzzyBasenameFilter,
  type TraceEvent,
} from '../../utils';
import {
  type BrowserExecutorLoadOptions,
  runBrowserDiscovery,
  validateBrowserRunConfig,
} from './loader';
import { getUserRstestConfigPluginProjects } from '../modifyRstestConfig';
import type { ProjectPlan } from '../projectPlan';
import type { Rstest } from '../rstest';

/**
 * The browser-side questions a resolved run plan can answer: which browser
 * projects run, and the option bags the browser executor/watch session are
 * launched with. `TestPlanner` re-exposes exactly this, so each command's
 * orchestrator asks one object and the filter-classification detail stays
 * under `core/browser/`.
 */
export interface BrowserRunPlan {
  hasBrowserTestsToRun(): boolean;
  getBrowserProjectsToRun(): ProjectContext[];
  /**
   * Options for constructing the real (non-discovery) browser executor, on
   * either command. `filesOnly` is owned by the discovery boot, never by a
   * real run.
   */
  getExecutorRunOptions(
    projects: ProjectContext[],
  ): Omit<BrowserExecutorLoadOptions, 'filesOnly'>;
}

interface BrowserRunPlanner extends BrowserRunPlan {
  /**
   * Boot the browser side once in files-only mode when the plan may depend on
   * browser `modifyRstestConfig` hooks (they only apply inside a browser
   * runtime boot and can add test files to an otherwise-empty project), then
   * re-resolve the run plan. No-op when discovery is not needed.
   *
   * `createTestPlanner` is the only caller and drives it while it is still
   * building, which is what keeps the once-only state below — the applied-hook
   * environment set and the discovery-ran flag — from ever being observed
   * half-applied: by the time anything holds a `TestPlanner`, discovery has
   * either finished or been declined.
   */
  runConfigHookDiscovery(): Promise<void>;
  /**
   * Validate the browser config exactly when nothing else will: an invalid
   * config (unsupported provider, core/browser version mismatch) has to fail
   * the command even when the plan left no browser test to run. Every path
   * that boots a browser runtime — the discovery boot above, the real executor
   * load — validates as part of booting, so this is a no-op whenever one of
   * them runs; validating twice would also reprint every unsupported-option
   * warning (`reportUnsupportedBrowserOptions` has no cross-call guard).
   * Driven by `createTestPlanner` after discovery, like the boot above.
   */
  ensureBrowserConfigValidated(): Promise<void>;
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
  getPlan: () => ProjectPlan;
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
  ): Omit<BrowserExecutorLoadOptions, 'filesOnly'> => ({
    shardedEntries: getBrowserShardedEntries(projects),
    freezeShardedEntries,
    allowEmptyRun: shouldAllowEmptyBrowserFallback(),
    appliedModifyRstestConfigEnvironments,
    configAlreadyValidated: hasRunBrowserConfigHookDiscovery,
  });

  return {
    async runConfigHookDiscovery() {
      // Deliberately not gated on having node projects. It used to be, back when
      // a zero-node run took a separate assembly that launched every browser
      // project — hooks fired at launch, so discovery had nothing to add. That
      // assembly is gone: every run now launches `getBrowserProjectsToRun()`,
      // and in a non-watch run `skipEmptyProjects` resolves a project with no
      // files on disk out of the plan before its hook can put any there.
      // Discovery is the only thing that fires those hooks in time, so a
      // zero-node non-watch run needs the boot exactly as much as a mixed one.
      //
      // Watch keeps `skipEmptyProjects: false`, so the project stays in the plan
      // and its hooks would fire at launch anyway — a zero-node watch startup
      // pays this boot for nothing. Accepted: gating it back on `isWatchMode`
      // re-splits the shape this predicate exists to keep single, for one boot
      // at startup.
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
    async ensureBrowserConfigValidated() {
      const nothingElseValidates =
        browserProjects.length > 0 &&
        !hasRunBrowserConfigHookDiscovery &&
        getPlan().browserProjectsToRun.length === 0 &&
        !shouldRunBrowserDiscoveryFallback();
      if (nothingElseValidates) {
        await validateBrowserRunConfig(context, browserProjects);
      }
    },
    hasBrowserTestsToRun: () =>
      getPlan().browserProjectsToRun.length > 0 ||
      shouldRunBrowserDiscoveryFallback(),
    getBrowserProjectsToRun,
    getExecutorRunOptions,
  };
}
