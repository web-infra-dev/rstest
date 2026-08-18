import type {
  FileFilterMode,
  ProjectContext,
  ProjectEntries,
  RstestContext,
} from '../types';
import {
  getTestEntries,
  logShardMessage,
  resolveShardedEntries,
  type ShardCounts,
} from '../utils';
import { resolveRunnableProjectsByEntries } from './environmentEntries';
import { refreshEnvironmentPartitionEntries } from './environmentPartitions';
import { isNodeProject } from './isBrowserProject';

export const getProjectEntries = async ({
  context,
  project,
  fileFilters,
  fileFilterMode,
}: {
  context: RstestContext;
  project: ProjectContext;
  fileFilters?: string[];
  fileFilterMode?: FileFilterMode;
}): Promise<Record<string, string>> => {
  const { include, exclude, includeSource, root } = project.normalizedConfig;

  return getTestEntries({
    include,
    exclude: exclude.patterns,
    includeSource,
    rootPath: context.rootPath,
    projectRoot: root,
    fileFilters,
    fileFilterMode,
  });
};

export type ProjectPlan = {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  browserProjectsToRun: ProjectContext[];
  nodeProjectsToRun: ProjectContext[];
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
} => {
  let allProjects = context.projects;
  let entriesCache: Map<string, ProjectEntries> = new Map();
  let browserProjectsToRun: ProjectContext[] = [];
  let nodeProjectsToRun: ProjectContext[] = [];
  let environmentGroupsResolved = false;
  let environmentGroupsChanged = false;
  let pendingStrictEnvironmentCommentValidation = false;
  let environmentPartitionRefresh: Promise<void> | undefined;
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

  // The node watch compiler owns an unfiltered graph; startup filters scope
  // executor cycles instead.
  const getProjectEntryFilter = (
    project: ProjectContext,
  ): {
    fileFilters: string[] | undefined;
    fileFilterMode: FileFilterMode | undefined;
  } =>
    isWatchMode && isNodeProject(project)
      ? { fileFilters: undefined, fileFilterMode: undefined }
      : {
          fileFilters: context.fileFilters,
          fileFilterMode: context.fileFilterMode,
        };

  const refreshEnvironmentPartitions = (): Promise<void> => {
    environmentPartitionRefresh ??= (async () => {
      const refreshed = await refreshEnvironmentPartitionEntries({
        context,
        projects: allProjects,
        getProjectEntries: (project) =>
          getProjectEntries({
            context,
            project,
            ...getProjectEntryFilter(project),
          }),
      });
      allProjects = refreshed.projects;
      entriesCache = refreshed.entriesCache;
      lastShardCounts = refreshed.shardCounts ?? lastShardCounts;
      context.projects = allProjects;
    })().finally(() => {
      environmentPartitionRefresh = undefined;
    });
    return environmentPartitionRefresh;
  };

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (context.relatedResolutionEmpty) {
      return {};
    }
    if (
      (!isWatchMode || context.normalizedConfig.shard) &&
      entriesCache.has(name)
    ) {
      return entriesCache.get(name)!.entries;
    }

    if (environmentGroupsResolved && environmentGroupsChanged) {
      // Environment-comment projects share one source glob. Refresh and regroup
      // that source as a unit so a dynamic watch entry never crosses the
      // environment partition that owns it.
      await refreshEnvironmentPartitions();
      return entriesCache.get(name)?.entries ?? {};
    }

    const project =
      allProjects.find((p) => p.environmentName === name) ??
      context.projects.find((p) => p.environmentName === name);
    if (!project) {
      return {};
    }

    // A watch compiler re-evaluates its dynamic entry on every rebuild. Re-glob
    // here instead of serving the planning snapshot so newly created matching
    // tests become entries and deleted tests leave the compilation.
    const { fileFilters, fileFilterMode } = getProjectEntryFilter(project);
    const entries = await getProjectEntries({
      context,
      project,
      fileFilters,
      fileFilterMode,
    });
    entriesCache.set(name, {
      entries,
      fileFilters,
    });

    return entries;
  };

  const resolveRunnableProjects = async ({
    strictEnvironmentComments = false,
  }: ResolveRunnableProjectsOptions = {}): Promise<ProjectPlan> => {
    const shouldPreserveEnvironmentPartitions =
      environmentGroupsResolved && environmentGroupsChanged;

    if (shouldPreserveEnvironmentPartitions) {
      await refreshEnvironmentPartitions();
    } else if (context.normalizedConfig.shard) {
      entriesCache =
        (await resolveShardedEntries(context, {
          getFileFilters: (project) =>
            getProjectEntryFilter(project).fileFilters,
          getFileFilterMode: (project) =>
            getProjectEntryFilter(project).fileFilterMode,
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
  };
};
