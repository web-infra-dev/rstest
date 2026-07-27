import type {
  NormalizedProjectConfig,
  ProjectContext,
  ProjectEntries,
} from '../types';
import type { EnvironmentComment } from '../utils';
import {
  applyEnvironmentComment,
  parseEnvironmentCommentFromFile,
} from '../utils';

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const formatEnvironmentName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9\-_$]/g, '_');

const formatGroupName = (projectName: string, groupIndex: number): string =>
  `${projectName}-environment-${groupIndex}`;

export const getProjectEnvironmentKey = (project: ProjectContext): string =>
  stableJson(project.normalizedConfig.testEnvironment);

export const getEnvironmentKey = (
  testEnvironment: NormalizedProjectConfig['testEnvironment'],
): string => stableJson(testEnvironment);

export const groupProjectEntriesByEnvironment = async ({
  entriesCache,
  projects,
  ignoreInvalidEnvironmentComments = false,
}: {
  entriesCache: Map<string, ProjectEntries>;
  projects: ProjectContext[];
  ignoreInvalidEnvironmentComments?: boolean;
}): Promise<{
  entriesCache: Map<string, ProjectEntries>;
  projects: ProjectContext[];
  changed: boolean;
}> => {
  const groupedEntriesCache = new Map<string, ProjectEntries>();
  const groupedProjects: ProjectContext[] = [];
  let changed = false;

  for (const project of projects) {
    const projectEntries = entriesCache.get(project.environmentName);
    if (!projectEntries) {
      groupedProjects.push(project);
      continue;
    }

    const groups = new Map<
      string,
      {
        config: NormalizedProjectConfig;
        entries: Record<string, string>;
        environmentComment?: EnvironmentComment;
        hasImplicitEntries: boolean;
      }
    >();

    const projectEntryItems = Object.entries(projectEntries.entries);
    if (projectEntryItems.length === 0) {
      groupedProjects.push(project);
      groupedEntriesCache.set(project.environmentName, projectEntries);
      continue;
    }
    const baseEnvironmentKey = getProjectEnvironmentKey(project);

    for (const [entryName, testPath] of projectEntryItems) {
      const comment = await parseEnvironmentCommentFromFile(testPath).catch(
        (error: unknown) => {
          if (ignoreInvalidEnvironmentComments) {
            return null;
          }
          throw error;
        },
      );
      const testEnvironment = comment
        ? applyEnvironmentComment(
            project.normalizedConfig.testEnvironment,
            comment,
          )
        : project.normalizedConfig.testEnvironment;
      const key = comment ? stableJson(testEnvironment) : baseEnvironmentKey;

      let group = groups.get(key);
      if (!group) {
        const config: NormalizedProjectConfig = {
          ...project.normalizedConfig,
          name: project.name,
          testEnvironment,
        };
        group = {
          config,
          entries: {},
          hasImplicitEntries: false,
        };
        groups.set(key, group);
      }

      if (comment) {
        group.environmentComment = comment;
      } else {
        group.hasImplicitEntries = true;
      }

      group.entries[entryName] = testPath;
    }

    const needsSplit = groups.size > 1 || !groups.has(baseEnvironmentKey);

    if (!needsSplit) {
      groupedProjects.push(project);
      groupedEntriesCache.set(project.environmentName, projectEntries);
      continue;
    }

    changed = true;
    let groupIndex = 0;
    const sourceEnvironmentName =
      project._environmentGroup?.sourceEnvironmentName ??
      project.environmentName;
    const sourceProjectName =
      project._environmentGroup?.sourceProjectName ?? project.name;
    const baseTestEnvironment =
      project._environmentGroup?.baseTestEnvironment ??
      project.normalizedConfig.testEnvironment;
    const globalSetupEnvironmentKey = groups.has(baseEnvironmentKey)
      ? baseEnvironmentKey
      : groups.keys().next().value;
    for (const [key, group] of groups) {
      const isBaseEnvironment = key === baseEnvironmentKey;
      const groupName = isBaseEnvironment
        ? project.name
        : formatGroupName(project.name, (groupIndex += 1));
      const environmentName = isBaseEnvironment
        ? project.environmentName
        : formatEnvironmentName(groupName);

      group.config.name = groupName;

      groupedProjects.push({
        ...project,
        name: groupName,
        environmentName,
        _environmentGroup: {
          key,
          baseKey: baseEnvironmentKey,
          baseTestEnvironment,
          sourceEnvironmentName,
          sourceProjectName,
          hasImplicitEntries: group.hasImplicitEntries,
          environmentComment: group.hasImplicitEntries
            ? undefined
            : group.environmentComment,
        },
        normalizedConfig: group.config,
        _globalSetups:
          project._globalSetups || key !== globalSetupEnvironmentKey,
      });
      groupedEntriesCache.set(environmentName, {
        ...projectEntries,
        entries: group.entries,
      });
    }
  }

  return {
    entriesCache: groupedEntriesCache,
    projects: groupedProjects,
    changed,
  };
};
