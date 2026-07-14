import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import { getTestEntries, resolveShardedEntries } from '../utils';
import {
  applyEnvironmentGroupsToListEntries,
  resolveRunnableProjectsByEntries,
} from './environmentEntries';
import { refreshEnvironmentPartitionEntries } from './environmentPartitions';

const getProjectEntries = async ({
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

const areFileFiltersEqual = (a?: string[], b?: string[]): boolean => {
  const left = a || [];
  const right = b || [];

  return left.length === right.length && left.every((v, i) => v === right[i]);
};

export type RunProjectPlan = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  browserProjectsToRun: ProjectContext[];
  nodeProjectsToRun: ProjectContext[];
};

export const syncNodeProjects = (
  target: ProjectContext[],
  projects: ProjectContext[],
): void => {
  target.splice(
    0,
    target.length,
    ...projects.filter((project) => !project.normalizedConfig.browser.enabled),
  );
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

const getEntriesCacheRecord = (
  entriesCache: Map<string, ProjectEntries>,
): Record<string, Record<string, string>> =>
  Object.fromEntries(
    Array.from(entriesCache.entries()).map(([environmentName, entries]) => [
      environmentName,
      entries.entries,
    ]),
  );

type ResolveRunnableProjectsOptions = {
  silentShardMessage?: boolean;
  strictEnvironmentComments?: boolean;
};

export const createRunProjectPlanState = ({
  context,
  browserProjects,
  isWatchMode,
}: {
  context: RstestContext;
  browserProjects: ProjectContext[];
  isWatchMode: boolean;
}): {
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  getPlan: () => RunProjectPlan;
  resolveRunnableProjects: (
    options?: ResolveRunnableProjectsOptions,
  ) => Promise<RunProjectPlan>;
  validateEnvironmentComments: () => Promise<void>;
} => {
  let allProjects = context.projects;
  let entriesCache: Map<string, ProjectEntries> = new Map();
  let browserProjectsToRun: ProjectContext[] = [];
  let nodeProjectsToRun: ProjectContext[] = [];
  let environmentGroupsResolved = false;
  let environmentGroupsChanged = false;
  let pendingStrictEnvironmentCommentValidation = false;

  const getPlan = (): RunProjectPlan => ({
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
        context.normalizedConfig.shard ||
        areFileFiltersEqual(cachedEntries.fileFilters, context.fileFilters))
    ) {
      return cachedEntries.entries;
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
    silentShardMessage = false,
    strictEnvironmentComments = false,
  }: ResolveRunnableProjectsOptions = {}): Promise<RunProjectPlan> => {
    const shouldPreserveEnvironmentPartitions =
      environmentGroupsResolved && environmentGroupsChanged;

    if (shouldPreserveEnvironmentPartitions) {
      const refreshed = await refreshEnvironmentPartitionEntries({
        context,
        projects: allProjects,
        getProjectEntries: (project) => getProjectEntries({ context, project }),
        shardMessage: {
          silent: silentShardMessage,
        },
      });
      allProjects = refreshed.projects;
      entriesCache = refreshed.entriesCache;
    } else if (context.normalizedConfig.shard) {
      entriesCache =
        (await resolveShardedEntries(context, {
          silent: silentShardMessage,
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

    if (isWatchMode && context.relatedResolutionEmpty) {
      browserProjectsToRun = browserProjects;
      nodeProjectsToRun = [];
    }

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

  return {
    globTestSourceEntries,
    getPlan,
    resolveRunnableProjects,
    validateEnvironmentComments,
  };
};

type RefreshListEntriesOptions = {
  silentShardMessage?: boolean;
  strictEnvironmentComments?: boolean;
};

export const createListProjectPlanState = (
  context: RstestContext,
): {
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  refreshListEntries: (options?: RefreshListEntriesOptions) => Promise<void>;
  validateEnvironmentComments: () => Promise<void>;
  getShardedBrowserEntries: () =>
    Map<string, { entries: Record<string, string> }> | undefined;
} => {
  const testEntries: Record<string, Record<string, string>> = {};
  let shardedBrowserEntries:
    Map<string, { entries: Record<string, string> }> | undefined;
  let environmentGroupsResolved = false;
  let environmentGroupsChanged = false;
  let pendingStrictEnvironmentCommentValidation = false;

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (testEntries[name]) {
      return testEntries[name];
    }

    const project = context.projects.find((p) => p.environmentName === name);
    if (!project) {
      return {};
    }

    const entries = await getProjectEntries({ context, project });
    testEntries[name] = entries;

    return entries;
  };

  const refreshListEntries = async ({
    silentShardMessage = true,
    strictEnvironmentComments = true,
  }: RefreshListEntriesOptions = {}): Promise<void> => {
    for (const key of Object.keys(testEntries)) {
      delete testEntries[key];
    }

    const shardedEntries = await resolveShardedEntries(context, {
      silent: silentShardMessage,
    });
    shardedBrowserEntries = undefined;

    if (context.normalizedConfig.shard && shardedEntries) {
      for (const [key, value] of shardedEntries.entries()) {
        testEntries[key] = value.entries;
      }

      shardedBrowserEntries = new Map();
      for (const project of context.projects.filter(
        (p) => p.normalizedConfig.browser.enabled,
      )) {
        shardedBrowserEntries.set(project.environmentName, {
          entries: testEntries[project.environmentName] || {},
        });
      }
    }

    const shouldPreserveEnvironmentPartitions =
      environmentGroupsResolved && environmentGroupsChanged;
    const ignoreInvalidEnvironmentComments = !strictEnvironmentComments;

    if (shouldPreserveEnvironmentPartitions) {
      const refreshed = await refreshEnvironmentPartitionEntries({
        context,
        projects: context.projects,
        getProjectEntries: (project) => getProjectEntries({ context, project }),
        shardMessage: {
          silent: silentShardMessage,
        },
      });
      context.projects = refreshed.projects;
      Object.assign(testEntries, getEntriesCacheRecord(refreshed.entriesCache));
      if (context.normalizedConfig.shard) {
        shardedBrowserEntries = new Map();
        for (const project of context.projects.filter(
          (p) => p.normalizedConfig.browser.enabled,
        )) {
          shardedBrowserEntries.set(project.environmentName, {
            entries:
              refreshed.entriesCache.get(project.environmentName)?.entries ||
              {},
          });
        }
      }
    } else {
      const grouped = await applyEnvironmentGroupsToListEntries({
        context,
        testEntries,
        globTestSourceEntries,
        ignoreInvalidEnvironmentComments,
      });
      if (!environmentGroupsResolved) {
        environmentGroupsChanged = grouped.changed;
      }
    }

    pendingStrictEnvironmentCommentValidation =
      ignoreInvalidEnvironmentComments;
    environmentGroupsResolved = true;
  };

  const validateEnvironmentComments = async (): Promise<void> => {
    if (!pendingStrictEnvironmentCommentValidation) {
      return;
    }

    await refreshListEntries({ strictEnvironmentComments: true });
    pendingStrictEnvironmentCommentValidation = false;
  };

  return {
    globTestSourceEntries,
    refreshListEntries,
    validateEnvironmentComments,
    getShardedBrowserEntries: () => shardedBrowserEntries,
  };
};
