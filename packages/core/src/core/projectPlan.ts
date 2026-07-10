import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import {
  applyEnvironmentComment,
  getShardedFiles,
  getTestEntries,
  resolveShardedEntries,
} from '../utils';
import {
  applyEnvironmentGroupsToListEntries,
  resolveRunnableProjectsByEntries,
} from './environmentEntries';
import {
  getEnvironmentKey,
  groupProjectEntriesByEnvironment,
} from './environmentGroups';

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

const isBrowserProject = (project: ProjectContext): boolean =>
  project.normalizedConfig.browser.enabled;

type RefreshEnvironmentPartitionResult = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
};

const refreshEnvironmentPartitionEntries = async ({
  context,
  projects,
}: {
  context: RstestContext;
  projects: ProjectContext[];
}): Promise<RefreshEnvironmentPartitionResult> => {
  const sourceProjects = new Map<string, ProjectContext[]>();
  for (const project of projects) {
    const sourceEnvironmentName =
      project._environmentGroup?.sourceEnvironmentName ??
      project.environmentName;
    const sourceKey = `${isBrowserProject(project) ? 'browser' : 'node'}:${sourceEnvironmentName}`;
    const sourceGroup = sourceProjects.get(sourceKey) ?? [];
    sourceGroup.push(project);
    sourceProjects.set(sourceKey, sourceGroup);
  }

  const refreshedEntries = [] as Array<{
    project: ProjectContext;
    alias: string;
    testPath: string;
  }>;
  const refreshedProjects: ProjectContext[] = [];

  for (const sourceGroup of sourceProjects.values()) {
    const firstProject = sourceGroup[0]!;
    if (isBrowserProject(firstProject)) {
      for (const project of sourceGroup) {
        refreshedProjects.push(project);
        const entries = await getProjectEntries({ context, project });
        for (const [alias, testPath] of Object.entries(entries)) {
          refreshedEntries.push({ project, alias, testPath });
        }
      }
      continue;
    }

    const sourceEnvironmentName =
      firstProject._environmentGroup?.sourceEnvironmentName ??
      firstProject.environmentName;
    const sourceProjectName =
      firstProject._environmentGroup?.sourceProjectName ?? firstProject.name;
    const baseProject = sourceGroup.find(
      (project) => project.environmentName === sourceEnvironmentName,
    );
    const sourceProject = baseProject ?? firstProject;
    const environmentGroup = sourceProject._environmentGroup;
    const baseTestEnvironment =
      baseProject?.normalizedConfig.testEnvironment ??
      environmentGroup?.baseTestEnvironment ??
      sourceProject.normalizedConfig.testEnvironment;
    const groupingProject: ProjectContext = {
      ...sourceProject,
      name: sourceProjectName,
      environmentName: sourceEnvironmentName,
      _environmentGroup: undefined,
      _globalSetups: baseProject ? sourceProject._globalSetups : false,
      normalizedConfig: {
        ...sourceProject.normalizedConfig,
        name: sourceProjectName,
        testEnvironment: baseTestEnvironment,
      },
    };
    const nextEntries = await getProjectEntries({
      context,
      project: groupingProject,
    });
    const regrouped = await groupProjectEntriesByEnvironment({
      entriesCache: new Map([
        [
          groupingProject.environmentName,
          {
            entries: nextEntries,
            fileFilters: context.fileFilters,
          },
        ],
      ]),
      projects: [groupingProject],
    });

    for (const regroupedProject of regrouped.projects) {
      const regroupedEnvironmentKey = getEnvironmentKey(
        regroupedProject.normalizedConfig.testEnvironment,
      );
      const project =
        sourceGroup.find((item) => {
          const group = item._environmentGroup;
          const expectedEnvironment = group?.environmentComment
            ? applyEnvironmentComment(
                baseTestEnvironment,
                group.environmentComment,
              )
            : baseTestEnvironment;

          return (
            getEnvironmentKey(expectedEnvironment) === regroupedEnvironmentKey
          );
        }) ?? regroupedProject;

      const group = regroupedProject._environmentGroup;
      const expectedEnvironment = group?.environmentComment
        ? applyEnvironmentComment(baseTestEnvironment, group.environmentComment)
        : baseTestEnvironment;
      project.normalizedConfig.testEnvironment = expectedEnvironment;
      refreshedProjects.push(project);
      const entries = regrouped.entriesCache.get(
        regroupedProject.environmentName,
      )?.entries;

      for (const [alias, testPath] of Object.entries(entries || {})) {
        refreshedEntries.push({ project, alias, testPath });
      }
    }
  }

  const entriesToRun = context.normalizedConfig.shard
    ? getShardedFiles(refreshedEntries, context.normalizedConfig.shard)
    : refreshedEntries;

  const refreshedEntriesCache = new Map<string, ProjectEntries>();
  for (const project of refreshedProjects) {
    refreshedEntriesCache.set(project.environmentName, {
      entries: {},
      fileFilters: context.fileFilters,
    });
  }

  for (const { project, alias, testPath } of entriesToRun) {
    refreshedEntriesCache.get(project.environmentName)!.entries[alias] =
      testPath;
  }

  return {
    projects: refreshedProjects,
    entriesCache: refreshedEntriesCache,
  };
};

type ResolveRunnableProjectsOptions = {
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
} => {
  let allProjects = context.projects;
  let entriesCache: Map<string, ProjectEntries> = new Map();
  let browserProjectsToRun: ProjectContext[] = [];
  let nodeProjectsToRun: ProjectContext[] = [];
  let environmentGroupsResolved = false;
  let environmentGroupsChanged = false;

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
  }: ResolveRunnableProjectsOptions = {}): Promise<RunProjectPlan> => {
    const shouldPreserveEnvironmentPartitions =
      environmentGroupsResolved && environmentGroupsChanged;

    if (shouldPreserveEnvironmentPartitions) {
      const refreshed = await refreshEnvironmentPartitionEntries({
        context,
        projects: allProjects,
      });
      allProjects = refreshed.projects;
      entriesCache = refreshed.entriesCache;
    } else if (context.normalizedConfig.shard) {
      entriesCache = (await resolveShardedEntries(context)) || new Map();
    } else {
      entriesCache = new Map();
    }

    const previousProjects = context.projects;
    const runnable = await resolveRunnableProjectsByEntries({
      entriesCache,
      projects: allProjects,
      globTestSourceEntries,
      groupEnvironmentComments: !shouldPreserveEnvironmentPartitions,
      ignoreInvalidEnvironmentComments: !strictEnvironmentComments,
      skipEmptyProjects: !isWatchMode,
    });

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
