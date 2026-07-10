import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import { applyEnvironmentComment, getShardedFiles } from '../utils';
import {
  getEnvironmentKey,
  groupProjectEntriesByEnvironment,
} from './environmentGroups';

type GetProjectEntries = (
  project: ProjectContext,
) => Promise<Record<string, string>>;

type RefreshEnvironmentPartitionResult = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
};

type RefreshEnvironmentPartitionEntry = {
  project: ProjectContext;
  alias: string;
  testPath: string;
};

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

const pushProjectEntries = (
  target: RefreshEnvironmentPartitionEntry[],
  project: ProjectContext,
  entries: Record<string, string> | undefined,
): void => {
  for (const [alias, testPath] of Object.entries(entries || {})) {
    target.push({ project, alias, testPath });
  }
};

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

const groupProjectsBySource = (
  projects: ProjectContext[],
): Map<string, ProjectContext[]> => {
  const sourceProjects = new Map<string, ProjectContext[]>();
  for (const project of projects) {
    const sourceKey = getSourceProjectKey(project);
    const sourceGroup = sourceProjects.get(sourceKey) ?? [];
    sourceGroup.push(project);
    sourceProjects.set(sourceKey, sourceGroup);
  }
  return sourceProjects;
};

export const refreshEnvironmentPartitionEntries = async ({
  context,
  projects,
  getProjectEntries,
}: {
  context: RstestContext;
  projects: ProjectContext[];
  getProjectEntries: GetProjectEntries;
}): Promise<RefreshEnvironmentPartitionResult> => {
  const sourceProjects = groupProjectsBySource(projects);
  const refreshedEntries: RefreshEnvironmentPartitionEntry[] = [];
  const refreshedProjects: ProjectContext[] = [];

  for (const sourceGroup of sourceProjects.values()) {
    const firstProject = sourceGroup[0]!;
    if (isBrowserProject(firstProject)) {
      for (const project of sourceGroup) {
        refreshedProjects.push(project);
        const entries = await getProjectEntries(project);
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
    const nextEntries = await getProjectEntries(groupingProject);
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
