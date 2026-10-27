import { existsSync } from 'node:fs';
import type { RsbuildInstance, RsbuildPlugin, Rspack } from '@rsbuild/core';
import { isAbsolute, normalize, relative, resolve } from 'pathe';
import type {
  InternalContext,
  InternalProjectContext,
  NormalizedProjectConfig,
} from '../../types';
import { getTestEntries, normalizeExactPathMatch } from '../../utils';
import { createSetupFileState } from '../config/setupFileState';
import { prepareRsbuild } from '../build/rsbuild';

type ModuleGraph = {
  allSources: Set<string>;
  dependentsBySource: Map<string, Set<string>>;
};

type ProjectConfigSnapshot = {
  project: InternalProjectContext;
  normalizedConfig: NormalizedProjectConfig;
  rootPath: string;
  outputModule: boolean;
};

const clonePlainConfig = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainConfig(item)) as T;
  }

  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePlainConfig(item)]),
    ) as T;
  }

  return value;
};

const snapshotProjectConfigs = (
  projects: InternalProjectContext[],
): ProjectConfigSnapshot[] =>
  projects.map((project) => ({
    project,
    normalizedConfig: clonePlainConfig(project.normalizedConfig),
    rootPath: project.rootPath,
    outputModule: project.outputModule,
  }));

const restoreProjectConfigs = (snapshots: ProjectConfigSnapshot[]): void => {
  for (const {
    project,
    normalizedConfig,
    rootPath,
    outputModule,
  } of snapshots) {
    project.normalizedConfig = normalizedConfig;
    project.rootPath = rootPath;
    project.outputModule = outputModule;
  }
};

const stripSourceProtocol = (source: string): string => {
  if (source.startsWith('file://')) {
    const path = source.slice('file://'.length);
    // Windows file URLs look like file:///C:/path — strip only the leading slash
    // before the drive letter. On POSIX, keep the leading slash: /home/...
    return /^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path;
  }
  return source.replace(/^[a-zA-Z]+:\/\//, '');
};

export const resolveStatsPathCandidate = ({
  candidate,
  projectRoot,
}: {
  candidate: string;
  projectRoot: string;
}): string | null => {
  let normalizedCandidate = stripSourceProtocol(candidate.trim());

  if (!normalizedCandidate) {
    return null;
  }

  const bangIndex = normalizedCandidate.lastIndexOf('!');
  if (bangIndex !== -1) {
    normalizedCandidate = normalizedCandidate.slice(bangIndex + 1);
  }

  if (
    normalizedCandidate.startsWith('builtin:') ||
    normalizedCandidate.startsWith('data:') ||
    normalizedCandidate.startsWith('webpack/') ||
    normalizedCandidate.startsWith('rspack/')
  ) {
    return null;
  }

  const queryIndex = normalizedCandidate.search(/[?#]/);
  if (queryIndex !== -1) {
    normalizedCandidate = normalizedCandidate.slice(0, queryIndex);
  }

  if (!normalizedCandidate) {
    return null;
  }

  const absolutePath = isAbsolute(normalizedCandidate)
    ? normalize(normalizedCandidate)
    : normalize(resolve(projectRoot, normalizedCandidate));

  return absolutePath;
};

const normalizeStatsPathCandidate = ({
  candidate,
  projectRoot,
  virtualModulePaths,
}: {
  candidate: string;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): string | null => {
  const absolutePath = resolveStatsPathCandidate({
    candidate,
    projectRoot,
  });

  return absolutePath &&
    (virtualModulePaths?.has(absolutePath) || existsSync(absolutePath))
    ? absolutePath
    : null;
};

const collectModuleGraph = ({
  compilation,
  projectRoot,
  virtualModulePaths,
}: {
  compilation: Rspack.Compilation;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): ModuleGraph => {
  const allSources = new Set<string>();
  const dependentsBySource = new Map<string, Set<string>>();
  const pathsByIdentifier = new Map<string, string>();
  const pathOf = (module: Rspack.Module): string => {
    const identifier = module.identifier();
    let path = pathsByIdentifier.get(identifier);
    if (!path) {
      // Context modules have synthetic identifiers. Keep them as intermediate
      // nodes so dependencies can reach the source file that imports the context.
      path =
        normalizeStatsPathCandidate({
          candidate: module.nameForCondition() || identifier,
          projectRoot,
          virtualModulePaths,
        }) || identifier;
      pathsByIdentifier.set(identifier, path);
      allSources.add(path);
    }
    return path;
  };
  const addEdge = (source: string, dependent: string) => {
    allSources.add(source);
    const dependents = dependentsBySource.get(source) || new Set<string>();
    dependents.add(dependent);
    dependentsBySource.set(source, dependents);
  };

  for (const module of compilation.modules) {
    const dependent = pathOf(module);
    for (const connection of compilation.moduleGraph.getOutgoingConnections(
      module,
    )) {
      // Concatenation can redirect the target; retain the original source too.
      if (connection.module) addEdge(pathOf(connection.module), dependent);
      if (connection.resolvedModule)
        addEdge(pathOf(connection.resolvedModule), dependent);
    }
  }

  return {
    allSources,
    dependentsBySource,
  };
};

const collectReachableDependents = ({
  dependentsBySource,
  initialSources,
}: {
  dependentsBySource: Map<string, Set<string>>;
  initialSources: Iterable<string>;
}): Set<string> => {
  const visited = new Set<string>();
  const queue = Array.from(initialSources);
  let queueIndex = 0;

  for (const source of queue) {
    visited.add(source);
  }

  while (queueIndex < queue.length) {
    const currentSource = queue[queueIndex++]!;

    for (const dependent of dependentsBySource.get(currentSource) || []) {
      if (visited.has(dependent)) {
        continue;
      }

      visited.add(dependent);
      queue.push(dependent);
    }
  }

  return visited;
};

const collectProjectEntries = async (
  context: InternalContext,
): Promise<Map<string, Record<string, string>>> => {
  const entries = new Map<string, Record<string, string>>();

  await Promise.all(
    context.projects.map(async (project) => {
      const { include, exclude, includeSource, root } =
        project.normalizedConfig;

      entries.set(
        project.environmentName,
        await getTestEntries({
          include,
          exclude: exclude.patterns,
          includeSource,
          rootPath: context.rootPath,
          projectRoot: root,
          fileFilters: undefined,
        }),
      );
    }),
  );

  return entries;
};

const createRelatedBuildSafeguardsPlugin = (): RsbuildPlugin => ({
  name: 'rstest:related-build-safeguards',
  setup(api) {
    api.modifyRsbuildConfig((config) => ({
      ...config,
      dev: {
        ...(config.dev || {}),
        lazyCompilation: false,
      },
      performance: {
        ...(config.performance || {}),
        buildCache: false,
      },
    }));
    api.modifyRspackConfig((rspackConfig) => {
      // Related-file graph collection needs a complete, fresh graph.
      // Keep it independent from user-enabled lazy compilation and
      // persistent cache settings.
      rspackConfig.lazyCompilation = false;
      rspackConfig.cache = false;
    });
  },
});

const collectDirectlyMatchedFiles = ({
  files,
  sourceFilters,
  rootPath,
}: {
  files: string[];
  sourceFilters: string[];
  rootPath: string;
}): string[] => {
  const exactSourcePaths = new Set<string>();

  for (const sourceFilter of sourceFilters) {
    exactSourcePaths.add(normalizeExactPathMatch(sourceFilter));
    exactSourcePaths.add(
      normalizeExactPathMatch(resolve(rootPath, sourceFilter)),
    );
  }

  return files.filter((filePath) => {
    const normalizedFilePath = normalizeExactPathMatch(filePath);
    const normalizedRelativeFilePath = normalizeExactPathMatch(
      relative(rootPath, filePath),
    );

    return (
      exactSourcePaths.has(normalizedFilePath) ||
      exactSourcePaths.has(normalizedRelativeFilePath)
    );
  });
};

export async function resolveRelatedTestFiles(
  context: InternalContext,
  options: {
    sourceFilters: string[];
    filterLabel?: string;
    allowEmpty?: boolean;
  },
): Promise<string[]> {
  const {
    sourceFilters,
    filterLabel = '--related',
    allowEmpty = false,
  } = options;

  if (sourceFilters.length === 0) {
    if (allowEmpty) {
      return [];
    }

    throw new Error(
      `The \`${filterLabel}\` option requires at least one source file path.`,
    );
  }

  let projectEntries = new Map<string, Record<string, string>>();
  const globTestSourceEntries = async (environmentName: string) =>
    projectEntries.get(environmentName) ?? {};

  const setupFileState = createSetupFileState();
  projectEntries = await collectProjectEntries(context);

  const projectConfigSnapshots = snapshotProjectConfigs(context.projects);
  let devServer:
    Awaited<ReturnType<RsbuildInstance['createDevServer']>> | undefined;

  try {
    const rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries,
      setupFileState,
      targetProjects: context.projects,
      exposeRstestAPIProjects: context.projects,
      extraPlugins: [createRelatedBuildSafeguardsPlugin()],
      collectDependencies: true,
      getSetupFileProjects: () => ({
        setupProjects: context.projects,
        globalSetupProjects: context.projects,
      }),
      onModifyRstestConfigApplied: async () => {
        projectEntries = await collectProjectEntries(context);
      },
    });

    devServer = await rsbuildInstance.createDevServer({
      getPortSilently: true,
    });

    const matchedTestFiles = new Set<string>();
    projectEntries = projectEntries.size
      ? projectEntries
      : await collectProjectEntries(context);

    for (const file of collectDirectlyMatchedFiles({
      files: Array.from(projectEntries.values()).flatMap((entries) =>
        Object.values(entries),
      ),
      sourceFilters,
      rootPath: context.rootPath,
    })) {
      matchedTestFiles.add(file);
    }

    for (const project of context.projects) {
      if (!projectEntries.has(project.environmentName)) {
        continue;
      }

      const environment = devServer.environments[project.environmentName]!;
      const stats = await environment.getStats();
      const moduleGraph = collectModuleGraph({
        compilation: stats.compilation,
        projectRoot: project.rootPath,
        virtualModulePaths: new Set(
          Object.keys(
            setupFileState.virtualModules[project.environmentName] || {},
          ),
        ),
      });
      const testPaths = Object.values(
        projectEntries.get(project.environmentName) || {},
      );
      const setupPaths = Object.values(
        setupFileState.setupFiles[project.environmentName] || {},
      );
      const globalSetupPaths = Object.values(
        setupFileState.globalSetupFiles[project.environmentName] || {},
      );
      const matchedSources = collectDirectlyMatchedFiles({
        files: Array.from(moduleGraph.allSources),
        sourceFilters,
        rootPath: context.rootPath,
      });

      if (matchedSources.length === 0) {
        continue;
      }

      const reachableDependents = collectReachableDependents({
        dependentsBySource: moduleGraph.dependentsBySource,
        initialSources: matchedSources,
      });

      const shouldRerunWholeProject =
        setupPaths.some((setupPath) => reachableDependents.has(setupPath)) ||
        globalSetupPaths.some((setupPath) =>
          reachableDependents.has(setupPath),
        );

      if (shouldRerunWholeProject) {
        for (const testPath of testPaths) {
          matchedTestFiles.add(testPath);
        }
        continue;
      }

      for (const testPath of testPaths) {
        if (reachableDependents.has(testPath)) {
          matchedTestFiles.add(testPath);
        }
      }
    }

    return Array.from(matchedTestFiles).sort();
  } finally {
    await devServer?.close();
    restoreProjectConfigs(projectConfigSnapshots);
  }
}
