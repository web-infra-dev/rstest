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

const getSourceEnvironmentName = (project: ProjectContext): string =>
  project._environmentGroup?.sourceEnvironmentName ?? project.environmentName;

const getSourceProjectName = (project: ProjectContext): string =>
  project._environmentGroup?.sourceProjectName ?? project.name;

const getSourceProjectKey = (project: ProjectContext): string =>
  `${isBrowserProject(project) ? 'browser' : 'node'}:${getSourceEnvironmentName(project)}`;

const hasEntries = (
  entriesCache: Map<string, ProjectEntries>,
  environmentName: string,
): boolean =>
  Object.keys(entriesCache.get(environmentName)?.entries || {}).length > 0;

const getSyntheticEnvironmentName = (
  sourceEnvironmentName: string,
  index: number,
): string =>
  `${sourceEnvironmentName}-environment-${index}`.replace(
    /[^a-zA-Z0-9\-_$]/g,
    '_',
  );

const getUniqueEnvironmentName = (
  environmentName: string,
  sourceEnvironmentName: string,
  usedEnvironmentNames: Set<string>,
): string => {
  if (!usedEnvironmentNames.has(environmentName)) {
    return environmentName;
  }

  let index = 1;
  let nextEnvironmentName = getSyntheticEnvironmentName(
    sourceEnvironmentName,
    index,
  );
  while (usedEnvironmentNames.has(nextEnvironmentName)) {
    nextEnvironmentName = getSyntheticEnvironmentName(
      sourceEnvironmentName,
      (index += 1),
    );
  }
  return nextEnvironmentName;
};

type RefreshEnvironmentPartitionResult = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
};

type RefreshEnvironmentPartitionEntry = {
  project: ProjectContext;
  alias: string;
  testPath: string;
};

const pushProjectEntries = (
  target: RefreshEnvironmentPartitionEntry[],
  project: ProjectContext,
  entries: Record<string, string> | undefined,
): void => {
  for (const [alias, testPath] of Object.entries(entries || {})) {
    target.push({ project, alias, testPath });
  }
};

const createEmptyEntriesCache = (
  projects: ProjectContext[],
  fileFilters: string[] | undefined,
): Map<string, ProjectEntries> =>
  new Map(
    projects.map((project) => [
      project.environmentName,
      {
        entries: {},
        fileFilters,
      },
    ]),
  );

const getRefreshBaseTestEnvironment = ({
  baseProject,
  sourceProject,
}: {
  baseProject: ProjectContext | undefined;
  sourceProject: ProjectContext;
}): ProjectContext['normalizedConfig']['testEnvironment'] => {
  const environmentGroup = sourceProject._environmentGroup;
  if (baseProject) {
    return baseProject.normalizedConfig.testEnvironment;
  }

  if (!environmentGroup?.environmentComment?.name) {
    return sourceProject.normalizedConfig.testEnvironment;
  }

  return (
    environmentGroup.baseTestEnvironment ??
    sourceProject.normalizedConfig.testEnvironment
  );
};

const findMatchingPartitionProject = ({
  baseTestEnvironment,
  sourceGroup,
  usedEnvironmentNames,
  environmentKey,
}: {
  baseTestEnvironment: ProjectContext['normalizedConfig']['testEnvironment'];
  sourceGroup: ProjectContext[];
  usedEnvironmentNames: Set<string>;
  environmentKey: string;
}): ProjectContext | undefined =>
  sourceGroup.find((project) => {
    const group = project._environmentGroup;
    const expectedEnvironment = group?.environmentComment
      ? applyEnvironmentComment(baseTestEnvironment, group.environmentComment)
      : baseTestEnvironment;

    return (
      !usedEnvironmentNames.has(project.environmentName) &&
      getEnvironmentKey(expectedEnvironment) === environmentKey
    );
  });

const reassignGlobalSetupOwner = ({
  entriesCache,
  projects,
  sourceProjects,
}: {
  entriesCache: Map<string, ProjectEntries>;
  projects: ProjectContext[];
  sourceProjects: Map<string, ProjectContext[]>;
}): void => {
  for (const sourceKey of sourceProjects.keys()) {
    const groupProjects = projects.filter(
      (project) => getSourceProjectKey(project) === sourceKey,
    );
    if (!groupProjects.some((project) => !project._globalSetups)) {
      continue;
    }

    const owner = groupProjects.find((project) =>
      hasEntries(entriesCache, project.environmentName),
    );
    if (!owner || !owner._globalSetups) {
      continue;
    }

    for (const project of groupProjects) {
      project._globalSetups = true;
    }
    owner._globalSetups = false;
  }
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
    const sourceKey = getSourceProjectKey(project);
    const sourceGroup = sourceProjects.get(sourceKey) ?? [];
    sourceGroup.push(project);
    sourceProjects.set(sourceKey, sourceGroup);
  }

  const refreshedEntries: RefreshEnvironmentPartitionEntry[] = [];
  const refreshedProjects: ProjectContext[] = [];

  for (const sourceGroup of sourceProjects.values()) {
    const firstProject = sourceGroup[0]!;
    if (isBrowserProject(firstProject)) {
      for (const project of sourceGroup) {
        refreshedProjects.push(project);
        const entries = await getProjectEntries({ context, project });
        pushProjectEntries(refreshedEntries, project, entries);
      }
      continue;
    }

    const sourceEnvironmentName = getSourceEnvironmentName(firstProject);
    const sourceProjectName = getSourceProjectName(firstProject);
    const baseProject = sourceGroup.find(
      (project) => project.environmentName === sourceEnvironmentName,
    );
    const sourceProject = baseProject ?? firstProject;
    const baseTestEnvironment = getRefreshBaseTestEnvironment({
      baseProject,
      sourceProject,
    });
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

    const reservedEnvironmentNames = new Set(
      sourceGroup.map((project) => project.environmentName),
    );
    const usedEnvironmentNames = new Set<string>();

    for (const regroupedProject of regrouped.projects) {
      const regroupedEnvironmentName = regroupedProject.environmentName;
      const regroupedEnvironmentKey = getEnvironmentKey(
        regroupedProject.normalizedConfig.testEnvironment,
      );
      const matchedProject = findMatchingPartitionProject({
        baseTestEnvironment,
        sourceGroup,
        usedEnvironmentNames,
        environmentKey: regroupedEnvironmentKey,
      });
      const project = matchedProject ?? regroupedProject;

      if (!matchedProject) {
        project.environmentName = getUniqueEnvironmentName(
          project.environmentName,
          sourceEnvironmentName,
          new Set([...reservedEnvironmentNames, ...usedEnvironmentNames]),
        );
      }

      const group = regroupedProject._environmentGroup;
      const expectedEnvironment = group?.environmentComment
        ? applyEnvironmentComment(baseTestEnvironment, group.environmentComment)
        : baseTestEnvironment;
      project._environmentGroup = regroupedProject._environmentGroup;
      project._globalSetups = regroupedProject._globalSetups;
      project.normalizedConfig.testEnvironment = expectedEnvironment;
      refreshedProjects.push(project);
      usedEnvironmentNames.add(project.environmentName);
      const entries = regrouped.entriesCache.get(
        regroupedEnvironmentName,
      )?.entries;
      pushProjectEntries(refreshedEntries, project, entries);
    }
  }

  const entriesToRun = context.normalizedConfig.shard
    ? getShardedFiles(refreshedEntries, context.normalizedConfig.shard)
    : refreshedEntries;

  const refreshedEntriesCache = createEmptyEntriesCache(
    refreshedProjects,
    context.fileFilters,
  );

  for (const { project, alias, testPath } of entriesToRun) {
    refreshedEntriesCache.get(project.environmentName)!.entries[alias] =
      testPath;
  }

  reassignGlobalSetupOwner({
    entriesCache: refreshedEntriesCache,
    projects: refreshedProjects,
    sourceProjects,
  });

  return {
    projects: refreshedProjects,
    entriesCache: refreshedEntriesCache,
  };
};

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
