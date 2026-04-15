import { existsSync } from 'node:fs';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { isAbsolute, normalize, relative, resolve } from 'pathe';
import type { ProjectContext, RstestContext } from '../types';
import { getTestEntries } from '../utils';
import { getSetupFiles } from '../utils/getSetupFiles';
import { prepareRsbuild } from './rsbuild';

type StatsModuleReason = NonNullable<Rspack.StatsModule['reasons']>[number];

type ModuleGraph = {
  allSources: Set<string>;
  dependentsBySource: Map<string, Set<string>>;
};

const stripSourceProtocol = (source: string): string =>
  source.replace(/^[a-zA-Z]+:\/\/\/?/, '');

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
}: {
  candidate: string;
  projectRoot: string;
}): string | null => {
  const absolutePath = resolveStatsPathCandidate({
    candidate,
    projectRoot,
  });

  return absolutePath && existsSync(absolutePath) ? absolutePath : null;
};

const normalizeStatsModulePath = ({
  module,
  projectRoot,
}: {
  module: Rspack.StatsModule;
  projectRoot: string;
}): string | null => {
  const candidate =
    typeof module.nameForCondition === 'string' && module.nameForCondition
      ? module.nameForCondition
      : module.identifier || '';

  return normalizeStatsPathCandidate({
    candidate,
    projectRoot,
  });
};

const normalizeStatsReasonPath = ({
  reason,
  projectRoot,
}: {
  reason: StatsModuleReason;
  projectRoot: string;
}): string | null => {
  const candidate =
    reason.moduleIdentifier || reason.moduleName || reason.module || '';

  return normalizeStatsPathCandidate({
    candidate,
    projectRoot,
  });
};

const collectModuleGraph = ({
  modules,
  projectRoot,
}: {
  modules: Rspack.StatsModule[] | undefined;
  projectRoot: string;
}): ModuleGraph => {
  const allSources = new Set<string>();
  const dependentsBySource = new Map<string, Set<string>>();

  const visitModules = (statsModules: Rspack.StatsModule[] | undefined) => {
    for (const module of statsModules || []) {
      const sourcePath = normalizeStatsModulePath({
        module,
        projectRoot,
      });

      if (sourcePath) {
        allSources.add(sourcePath);

        for (const reason of module.reasons || []) {
          const dependentPath = normalizeStatsReasonPath({
            reason,
            projectRoot,
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

const collectReachableDependents = ({
  dependentsBySource,
  initialSources,
}: {
  dependentsBySource: Map<string, Set<string>>;
  initialSources: Iterable<string>;
}): Set<string> => {
  const visited = new Set<string>();
  const queue = Array.from(initialSources);

  for (const source of queue) {
    visited.add(source);
  }

  while (queue.length > 0) {
    const currentSource = queue.shift()!;

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
  context: RstestContext,
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
          fileFilters: [],
        }),
      );
    }),
  );

  return entries;
};

const buildSetupFiles = (
  projects: ProjectContext[],
  key: 'setupFiles' | 'globalSetup',
): Record<string, Record<string, string>> => {
  return Object.fromEntries(
    projects.map((project) => [
      project.environmentName,
      getSetupFiles(project.normalizedConfig[key], project.rootPath),
    ]),
  );
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

const normalizeExactPathMatch = (filePath: string): string => {
  const normalizedPath = normalize(filePath);

  return process.platform === 'win32'
    ? normalizedPath.toLocaleLowerCase()
    : normalizedPath;
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
  context: RstestContext,
  sourceFilters: string[],
): Promise<string[]> {
  if (sourceFilters.length === 0) {
    throw new Error(
      'The `--related` option requires at least one source file path.',
    );
  }

  const projectEntries = await collectProjectEntries(context);
  const matchedTestFiles = new Set(
    collectDirectlyMatchedFiles({
      files: Array.from(projectEntries.values()).flatMap((entries) =>
        Object.values(entries),
      ),
      sourceFilters,
      rootPath: context.rootPath,
    }),
  );

  const globTestSourceEntries = async (environmentName: string) =>
    projectEntries.get(environmentName) ?? {};

  const setupFiles = buildSetupFiles(context.projects, 'setupFiles');
  const globalSetupFiles = buildSetupFiles(context.projects, 'globalSetup');

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    context.projects,
    [createRelatedBuildSafeguardsPlugin()],
  );

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  try {
    for (const project of context.projects) {
      const environment = devServer.environments[project.environmentName]!;
      const stats = await environment.getStats();
      const { modules } = stats.toJson({
        all: false,
        modules: true,
        nestedModules: true,
        reasons: true,
      });

      const moduleGraph = collectModuleGraph({
        modules,
        projectRoot: project.rootPath,
      });
      const testPaths = Object.values(
        projectEntries.get(project.environmentName) || {},
      );
      const setupPaths = Object.values(
        setupFiles[project.environmentName] || {},
      );
      const globalSetupPaths = Object.values(
        globalSetupFiles[project.environmentName] || {},
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
  } finally {
    await devServer.close();
  }

  return Array.from(matchedTestFiles).sort();
}
