import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import {
  getTestEntries,
  logShardMessage,
  resolveShardedEntries,
  type ShardCounts,
} from '../utils';
import { groupProjectEntriesByEnvironment } from './environmentGroups';
import { resolveRunnableProjectsByEntries } from './environmentEntries';
import { refreshEnvironmentPartitionEntries } from './environmentPartitions';
import { isNodeProject } from './isBrowserProject';

export const getProjectEntries = async ({
  context,
  project,
}: {
  context: RstestContext;
  project: ProjectContext;
}): Promise<Record<string, string>> => {
  const { include, exclude, includeSource, root } = project.normalizedConfig;

  return getTestEntries({
    include,
    exclude: exclude.patterns,
    includeSource,
    rootPath: context.rootPath,
    projectRoot: root,
    fileFilters: context.fileFilters || [],
    fileFilterMode: context.fileFilterMode,
  });
};

/**
 * Watch's initial file filter controls the first run, but it must not control
 * which compiler environments exist: a later `a`/`p` can reveal an annotated
 * file that needs a synthetic environment. Discover those environments before
 * Rsbuild is created, while leaving the actual plan scoped to the filter.
 */
export const discoverWatchEnvironmentProjects = async ({
  context,
  projects,
}: {
  context: RstestContext;
  projects: ProjectContext[];
}): Promise<ProjectContext[]> => {
  if (!context.fileFilters?.length || !projects.length) {
    return [];
  }

  const fileFilters = context.fileFilters;
  context.fileFilters = undefined;
  try {
    const entriesCache = new Map<string, ProjectEntries>(
      await Promise.all(
        projects.map(
          async (project) =>
            [
              project.environmentName,
              {
                entries: await getProjectEntries({ context, project }),
                fileFilters: undefined,
              },
            ] as const,
        ),
      ),
    );
    const grouped = await groupProjectEntriesByEnvironment({
      entriesCache,
      projects,
      ignoreInvalidEnvironmentComments: true,
    });
    return grouped.projects;
  } finally {
    context.fileFilters = fileFilters;
  }
};

export type ProjectPlan = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  browserProjectsToRun: ProjectContext[];
  nodeProjectsToRun: ProjectContext[];
};

const areFileFiltersEqual = (left?: string[], right?: string[]): boolean => {
  const leftFilters = left ?? [];
  const rightFilters = right ?? [];

  return (
    leftFilters.length === rightFilters.length &&
    leftFilters.every((filter, index) => filter === rightFilters[index])
  );
};

export const syncNodeProjects = (
  target: ProjectContext[],
  projects: ProjectContext[],
): void => {
  target.splice(0, target.length, ...projects.filter(isNodeProject));
};

const isSameProjectList = (
  left: ProjectContext[],
  right: ProjectContext[],
): boolean =>
  left.length === right.length &&
  left.every((project, index) => {
    const other = right[index];
    return (
      other?.name === project.name &&
      other.environmentName === project.environmentName
    );
  });

type ResolveRunnableProjectsOptions = {
  strictEnvironmentComments?: boolean;
};

type PlanRefreshHandler = (plan: ProjectPlan) => Promise<void>;

export const createProjectPlanState = ({
  context,
  isWatchMode,
}: {
  context: RstestContext;
  isWatchMode: boolean;
}): {
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  getPlan: () => ProjectPlan;
  resolveRunnableProjects: (
    options?: ResolveRunnableProjectsOptions,
  ) => Promise<ProjectPlan>;
  validateEnvironmentComments: () => Promise<void>;
  announceShardSlice: () => void;
  setPlanRefreshHandler: (handler: PlanRefreshHandler) => void;
} => {
  let allProjects = context.projects;
  let entriesCache: Map<string, ProjectEntries> = new Map();
  let browserProjectsToRun: ProjectContext[] = [];
  let nodeProjectsToRun: ProjectContext[] = [];
  let environmentGroupsResolved = false;
  let environmentGroupsChanged = false;
  let runnableProjectsRefresh: Promise<ProjectPlan> | undefined;
  let planRefreshHandler: PlanRefreshHandler | undefined;
  let pendingStrictEnvironmentCommentValidation = false;
  // Resolution never logs the shard banner — it can run several times per init
  // (pre-hook, post-hook, post-discovery) and each pass would print its own
  // interim counts. Every resolve records the freshest counts here and the
  // planner announces them exactly once, after the barrier closes.
  let lastShardCounts: ShardCounts | undefined;

  const getPlan = (): ProjectPlan => ({
    projects: allProjects,
    entriesCache,
    browserProjectsToRun,
    nodeProjectsToRun,
  });

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (context.relatedResolutionEmpty) {
      return {};
    }
    const cachedEntries = entriesCache.get(name);
    if (
      cachedEntries &&
      (!isWatchMode ||
        areFileFiltersEqual(cachedEntries.fileFilters, context.fileFilters))
    ) {
      return cachedEntries.entries;
    }

    if (
      isWatchMode &&
      cachedEntries &&
      (context.normalizedConfig.shard || environmentGroupsResolved)
    ) {
      runnableProjectsRefresh ??= resolveRunnableProjects({
        strictEnvironmentComments: true,
      }).finally(() => {
        runnableProjectsRefresh = undefined;
      });
      const refreshedPlan = await runnableProjectsRefresh;
      return refreshedPlan.entriesCache.get(name)?.entries || {};
    }

    const project =
      allProjects.find((p) => p.environmentName === name) ??
      context.projects.find((p) => p.environmentName === name);
    if (!project) {
      return {};
    }

    const entries = await getProjectEntries({ context, project });
    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    return entries;
  };

  const resolveRunnableProjects = async ({
    strictEnvironmentComments = false,
  }: ResolveRunnableProjectsOptions = {}): Promise<ProjectPlan> => {
    const shouldPreserveEnvironmentPartitions =
      environmentGroupsResolved && environmentGroupsChanged;

    if (shouldPreserveEnvironmentPartitions) {
      const refreshed = await refreshEnvironmentPartitionEntries({
        context,
        projects: allProjects,
        getProjectEntries: (project) => getProjectEntries({ context, project }),
      });
      allProjects = refreshed.projects;
      entriesCache = refreshed.entriesCache;
      lastShardCounts = refreshed.shardCounts ?? lastShardCounts;
    } else if (context.normalizedConfig.shard) {
      entriesCache =
        (await resolveShardedEntries(context, {
          onShardCounts: (counts) => {
            lastShardCounts = counts;
          },
        })) || new Map();
    } else {
      entriesCache = new Map();
    }

    const previousProjects = context.projects;
    const ignoreInvalidEnvironmentComments = !strictEnvironmentComments;
    const runnable = await resolveRunnableProjectsByEntries({
      entriesCache,
      projects: allProjects,
      globTestSourceEntries,
      groupEnvironmentComments: !shouldPreserveEnvironmentPartitions,
      ignoreInvalidEnvironmentComments,
      skipEmptyProjects: !isWatchMode,
    });
    pendingStrictEnvironmentCommentValidation =
      ignoreInvalidEnvironmentComments;

    if (!environmentGroupsResolved) {
      environmentGroupsChanged = !isSameProjectList(
        previousProjects,
        runnable.projects,
      );
    }

    allProjects = runnable.projects;
    entriesCache = runnable.entriesCache;
    context.projects = allProjects;
    browserProjectsToRun = runnable.browserProjectsToRun;
    nodeProjectsToRun = runnable.nodeProjectsToRun;

    if (isWatchMode && context.normalizedConfig.shard) {
      const hasShardedEntries = (project: ProjectContext): boolean =>
        Object.keys(entriesCache.get(project.environmentName)?.entries || {})
          .length > 0;

      browserProjectsToRun = browserProjectsToRun.filter(hasShardedEntries);
      nodeProjectsToRun = nodeProjectsToRun.filter(hasShardedEntries);
    }

    await planRefreshHandler?.(getPlan());

    environmentGroupsResolved = true;
    return getPlan();
  };

  const validateEnvironmentComments = async (): Promise<void> => {
    if (!pendingStrictEnvironmentCommentValidation) {
      return;
    }

    await resolveRunnableProjects({ strictEnvironmentComments: true });
    pendingStrictEnvironmentCommentValidation = false;
  };

  const announceShardSlice = (): void => {
    const { shard } = context.normalizedConfig;
    if (!shard || !lastShardCounts) {
      return;
    }
    logShardMessage({ shard, ...lastShardCounts });
    // Consumed on print, so a second announce is structurally a no-op.
    lastShardCounts = undefined;
  };

  return {
    globTestSourceEntries,
    getPlan,
    resolveRunnableProjects,
    validateEnvironmentComments,
    announceShardSlice,
    setPlanRefreshHandler: (handler) => {
      planRefreshHandler = handler;
    },
  };
};
