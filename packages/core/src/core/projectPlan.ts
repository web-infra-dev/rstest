import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import { getTestEntries, resolveShardedEntries } from '../utils';
import {
  applyEnvironmentGroupsToListEntries,
  resolveRunnableProjectsByEntries,
} from './environmentEntries';

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
  resolveRunnableProjects: () => Promise<RunProjectPlan>;
} => {
  let allProjects = context.projects;
  let entriesCache: Map<string, ProjectEntries> = new Map();
  let browserProjectsToRun: ProjectContext[] = [];
  let nodeProjectsToRun: ProjectContext[] = [];
  let runnableProjectsResolved = false;

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
    if (entriesCache.has(name)) {
      return entriesCache.get(name)!.entries;
    }

    const project = allProjects.find((p) => p.environmentName === name);
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

  const resolveRunnableProjects = async (): Promise<RunProjectPlan> => {
    if (runnableProjectsResolved) {
      return getPlan();
    }

    if (context.normalizedConfig.shard) {
      entriesCache = (await resolveShardedEntries(context)) || new Map();
    }

    const runnable = await resolveRunnableProjectsByEntries({
      entriesCache,
      projects: context.projects,
      globTestSourceEntries,
      skipEmptyProjects: !isWatchMode,
    });

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

    runnableProjectsResolved = true;
    return getPlan();
  };

  return {
    globTestSourceEntries,
    getPlan,
    resolveRunnableProjects,
  };
};

export const createListProjectPlanState = (
  context: RstestContext,
): {
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  refreshListEntries: (options?: {
    silentShardMessage?: boolean;
  }) => Promise<void>;
  getShardedBrowserEntries: () =>
    Map<string, { entries: Record<string, string> }> | undefined;
} => {
  const testEntries: Record<string, Record<string, string>> = {};
  let shardedBrowserEntries:
    Map<string, { entries: Record<string, string> }> | undefined;

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
  }: { silentShardMessage?: boolean } = {}): Promise<void> => {
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

    await applyEnvironmentGroupsToListEntries({
      context,
      testEntries,
      globTestSourceEntries,
    });
  };

  return {
    globTestSourceEntries,
    refreshListEntries,
    getShardedBrowserEntries: () => shardedBrowserEntries,
  };
};
