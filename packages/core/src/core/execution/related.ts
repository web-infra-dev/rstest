import { existsSync } from 'node:fs';
import type { RsbuildInstance, RsbuildPlugin, Rspack } from '@rsbuild/core';
import { extname, isAbsolute, normalize, relative, resolve } from 'pathe';
import type {
  InternalContext,
  InternalProjectContext,
  NormalizedProjectConfig,
} from '../../types';
import { getTestEntries, logger, normalizeExactPathMatch } from '../../utils';
import { createSetupFileState } from '../config/setupFileState';
import { prepareRsbuild } from '../build/rsbuild';

type StatsModuleReason = NonNullable<Rspack.StatsModule['reasons']>[number];

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

const normalizeStatsModulePath = ({
  module,
  projectRoot,
  virtualModulePaths,
}: {
  module: Rspack.StatsModule;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): string | null => {
  const candidate =
    typeof module.nameForCondition === 'string' && module.nameForCondition
      ? module.nameForCondition
      : module.identifier || '';

  return normalizeStatsPathCandidate({
    candidate,
    projectRoot,
    virtualModulePaths,
  });
};

const normalizeStatsReasonPath = ({
  reason,
  projectRoot,
  virtualModulePaths,
}: {
  reason: StatsModuleReason;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): string | null => {
  const candidate =
    reason.moduleIdentifier || reason.moduleName || reason.module || '';

  return normalizeStatsPathCandidate({
    candidate,
    projectRoot,
    virtualModulePaths,
  });
};

const collectModuleGraph = ({
  modules,
  projectRoot,
  virtualModulePaths,
}: {
  modules: Rspack.StatsModule[] | undefined;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): ModuleGraph => {
  const allSources = new Set<string>();
  const dependentsBySource = new Map<string, Set<string>>();

  const visitModules = (statsModules: Rspack.StatsModule[] | undefined) => {
    for (const module of statsModules || []) {
      const sourcePath = normalizeStatsModulePath({
        module,
        projectRoot,
        virtualModulePaths,
      });

      if (sourcePath) {
        allSources.add(sourcePath);

        for (const reason of module.reasons || []) {
          const dependentPath = normalizeStatsReasonPath({
            reason,
            projectRoot,
            virtualModulePaths,
          });

          if (!dependentPath) {
            continue;
          }

          allSources.add(dependentPath);

          const dependents = dependentsBySource.get(sourcePath) || new Set();
          dependents.add(dependentPath);
          dependentsBySource.set(sourcePath, dependents);
        }
      }

      if (module.modules?.length) {
        visitModules(module.modules);
      }
    }
  };

  visitModules(modules);

  return {
    allSources,
    dependentsBySource,
  };
};

/**
 * Shape of the build-time dependency metadata Rspack records on a module.
 * Loaders report the files they read through `buildInfo`; those files are
 * dependencies of the module but never become modules themselves, so the
 * module graph built from stats cannot see them.
 */
type BuildInputModule = {
  nameForCondition?: () => string | undefined;
  buildInfo?: {
    fileDependencies?: Iterable<string>;
    missingDependencies?: Iterable<string>;
  };
  modules?: readonly BuildInputModule[];
};

const declaresBuildInput = (
  module: BuildInputModule,
  sources: ReadonlySet<string>,
): boolean => {
  const { fileDependencies, missingDependencies } = module.buildInfo ?? {};

  for (const dependencies of [fileDependencies, missingDependencies]) {
    for (const dependency of dependencies ?? []) {
      if (sources.has(normalizeExactPathMatch(dependency))) {
        return true;
      }
    }
  }

  // Concatenation keeps the loader metadata on the inner modules, while imports
  // point at the wrapper.
  return (module.modules ?? []).some((innerModule) =>
    declaresBuildInput(innerModule, sources),
  );
};

/**
 * Map requested source paths to the modules whose loaders declared them as
 * build inputs. Each match becomes an extra traversal root for reverse import
 * reachability; build-input relations are never added as graph edges, otherwise
 * they would chain with import edges and select consumers that do not actually
 * read the requested file. Concatenated modules expose the inner modules that
 * hold the loader metadata, so the match is attributed to the wrapper that the
 * import edges point at.
 *
 * Only exact file declarations are considered. A directory dependency tells
 * Rspack to watch a directory, not which files under it the loader reads, so
 * expanding it to `directory + every file` would invent dependencies the build
 * never declared.
 */
const collectBuildInputConsumers = ({
  modules,
  sources,
  projectRoot,
  virtualModulePaths,
}: {
  modules: Iterable<BuildInputModule>;
  /** Absolute source paths, normalized with `normalizeExactPathMatch`. */
  sources: ReadonlySet<string>;
  projectRoot: string;
  virtualModulePaths?: ReadonlySet<string>;
}): Set<string> => {
  const consumers = new Set<string>();
  if (sources.size === 0) {
    return consumers;
  }

  for (const module of modules) {
    if (!declaresBuildInput(module, sources)) {
      continue;
    }

    const candidate = module.nameForCondition?.();
    if (!candidate) {
      continue;
    }

    const consumer = normalizeStatsPathCandidate({
      candidate,
      projectRoot,
      virtualModulePaths,
    });

    if (consumer) {
      consumers.add(consumer);
    }
  }

  return consumers;
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

/**
 * Missing source files are materialized as empty modules in the analysis build
 * so imports that still reference them keep their module-graph edges. The
 * placeholder has to parse as the module type its extension implies: JSON needs
 * valid JSON and ESM needs ESM syntax. The execution build always uses the real
 * filesystem, so a selected test still fails on the missing import.
 */
const createMissingSourcePlaceholder = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.json') {
    return '{}';
  }

  if (extension === '.mjs' || extension === '.mts') {
    return 'export {};';
  }

  return '';
};

const createRelatedBuildSafeguardsPlugin = (
  missingSources: string[],
): RsbuildPlugin => ({
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
    api.modifyRspackConfig((rspackConfig, { rspack }) => {
      // Related-file graph collection needs a complete, fresh graph.
      // Keep it independent from user-enabled lazy compilation and
      // persistent cache settings.
      rspackConfig.lazyCompilation = false;
      rspackConfig.cache = false;
      // Keep incoming edges to deleted files in this analysis-only build.
      // The execution build still resolves against the real filesystem.
      if (missingSources.length) {
        rspackConfig.plugins.push(
          new rspack.experiments.VirtualModulesPlugin(
            Object.fromEntries(
              missingSources.map((file) => [
                file,
                createMissingSourcePlaceholder(file),
              ]),
            ),
          ),
        );
      }
    });
  },
});

/**
 * Collect the module paths reported by the analysis build errors. Test files
 * in this set could not be analyzed, so they cannot be matched reliably.
 */
const collectErrorModulePaths = ({
  errors,
  projectRoot,
}: {
  errors:
    readonly { moduleIdentifier?: string; moduleName?: string }[] | undefined;
  projectRoot: string;
}): Set<string> => {
  const errorModulePaths = new Set<string>();

  for (const error of errors || []) {
    const candidate = error.moduleIdentifier || error.moduleName;

    if (!candidate) {
      continue;
    }

    const absolutePath = resolveStatsPathCandidate({
      candidate,
      projectRoot,
    });

    if (absolutePath) {
      errorModulePaths.add(normalize(absolutePath));
    }
  }

  return errorModulePaths;
};

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
    /**
     * Absolute paths the caller knows no longer resolve to a file: a deleted
     * source, or a tracked file replaced by a directory of the same name (which
     * `existsSync` cannot detect).
     */
    missingSourceFiles?: string[];
  },
): Promise<string[]> {
  const {
    sourceFilters,
    filterLabel = '--related',
    allowEmpty = false,
    missingSourceFiles,
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
  const missingSources = Array.from(
    new Set(
      missingSourceFiles
        ? missingSourceFiles.map((source) => normalize(source))
        : sourceFilters
            .map((source) => normalize(resolve(context.rootPath, source)))
            .filter((source) => !existsSync(source)),
    ),
  );
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
      extraPlugins: [createRelatedBuildSafeguardsPlugin(missingSources)],
      logLevel: 'silent',
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
    let failedTestFileCount = 0;

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

    // Source filters are filesystem paths, not stats identifiers: keep `!`,
    // `#`, `?` and whitespace that are part of the name. `resolveStatsPathCandidate`
    // strips those for loader/query identifiers and must not be used here.
    const buildInputSources = new Set(
      sourceFilters.map((source) =>
        normalizeExactPathMatch(resolve(context.rootPath, source)),
      ),
    );

    for (const project of context.projects) {
      if (!projectEntries.has(project.environmentName)) {
        continue;
      }

      const environment = devServer.environments[project.environmentName]!;
      const stats = await environment.getStats();
      const analysisHasErrors = stats.hasErrors();
      const { modules, errors } = stats.toJson({
        all: false,
        modules: true,
        errors: true,
        nestedModules: true,
        reasons: true,
      });

      const virtualModulePaths = new Set([
        ...missingSources,
        ...Object.keys(
          setupFileState.virtualModules[project.environmentName] || {},
        ),
      ]);
      const moduleGraph = collectModuleGraph({
        modules,
        projectRoot: project.rootPath,
        virtualModulePaths,
      });
      const testPaths = Object.values(
        projectEntries.get(project.environmentName) || {},
      );

      if (analysisHasErrors) {
        const errorModulePaths = collectErrorModulePaths({
          errors,
          projectRoot: project.rootPath,
        });
        failedTestFileCount += testPaths.filter((testPath) =>
          errorModulePaths.has(normalize(testPath)),
        ).length;
      }

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
      const buildInputConsumers = collectBuildInputConsumers({
        modules: stats.compilation.modules,
        sources: buildInputSources,
        projectRoot: project.rootPath,
        virtualModulePaths,
      });
      const initialSources = [...matchedSources, ...buildInputConsumers];

      if (initialSources.length === 0) {
        continue;
      }

      const reachableDependents = collectReachableDependents({
        dependentsBySource: moduleGraph.dependentsBySource,
        initialSources,
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

    if (failedTestFileCount > 0) {
      logger.warn(
        `Related test selection may be incomplete: ${failedTestFileCount} test file(s) failed to build and could not be analyzed.`,
      );
    }

    return Array.from(matchedTestFiles).sort();
  } finally {
    await devServer?.close();
    restoreProjectConfigs(projectConfigSnapshots);
  }
}
