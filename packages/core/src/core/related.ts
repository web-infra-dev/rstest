import { existsSync } from 'node:fs';
import type { Rspack } from '@rsbuild/core';
import { normalize, resolve } from 'pathe';
import type { ProjectContext, RstestContext } from '../types';
import { filterFiles, getTestEntries } from '../utils';
import { getSetupFiles } from '../utils/getSetupFiles';
import { loadBrowserModule } from './browserLoader';
import { prepareRsbuild } from './rsbuild';

type StatsModuleReason = NonNullable<Rspack.StatsModule['reasons']>[number];

type ModuleGraph = {
  allSources: Set<string>;
  dependentsBySource: Map<string, Set<string>>;
};

const stripSourceProtocol = (source: string): string =>
  source.replace(/^[a-zA-Z]+:\/\/\/?/, '');

const normalizeStatsPathCandidate = ({
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

  const absolutePath = normalizedCandidate.startsWith('/')
    ? normalize(normalizedCandidate)
    : normalize(resolve(projectRoot, normalizedCandidate));

  return existsSync(absolutePath) ? absolutePath : null;
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
    filterFiles(
      Array.from(projectEntries.values()).flatMap((entries) =>
        Object.values(entries),
      ),
      sourceFilters,
      context.rootPath,
    ),
  );

  const nodeProjects = context.projects.filter(
    (project) => !project.normalizedConfig.browser.enabled,
  );
  const browserProjects = context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );

  if (nodeProjects.length > 0) {
    const globTestSourceEntries = async (environmentName: string) =>
      projectEntries.get(environmentName) ?? {};

    const setupFiles = buildSetupFiles(nodeProjects, 'setupFiles');
    const globalSetupFiles = buildSetupFiles(context.projects, 'globalSetup');

    const rsbuildInstance = await prepareRsbuild(
      context,
      globTestSourceEntries,
      setupFiles,
      globalSetupFiles,
      nodeProjects,
    );

    const devServer = await rsbuildInstance.createDevServer({
      getPortSilently: true,
    });

    try {
      for (const project of nodeProjects) {
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
        const matchedSources = filterFiles(
          Array.from(moduleGraph.allSources),
          sourceFilters,
          context.rootPath,
        );

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
  }

  if (browserProjects.length > 0) {
    const { resolveRelatedBrowserTestFiles } = await loadBrowserModule({
      projectRoots: browserProjects.map((project) => project.rootPath),
    });
    const browserRelatedFiles = await resolveRelatedBrowserTestFiles(
      context,
      sourceFilters,
    );

    for (const testPath of browserRelatedFiles) {
      matchedTestFiles.add(testPath);
    }
  }

  return Array.from(matchedTestFiles).sort();
}
