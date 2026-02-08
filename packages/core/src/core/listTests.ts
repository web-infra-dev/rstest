import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { createPool } from '../pool';
import type {
  FormattedError,
  ListCommandOptions,
  ListCommandResult,
  Location,
  ProjectContext,
  RstestContext,
  Test,
} from '../types';
import {
  bgColor,
  color,
  getTaskNameWithPrefix,
  getTestEntries,
  logger,
  prettyTestPath,
  ROOT_SUITE_NAME,
  resolveShardedEntries,
} from '../utils';
import { runGlobalSetup, runGlobalTeardown } from './globalSetup';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

/**
 * Collect tests from node mode projects using Rsbuild and worker pool.
 */
const collectNodeTests = async ({
  context,
  nodeProjects,
  globTestSourceEntries,
}: {
  context: RstestContext;
  nodeProjects: ProjectContext[];
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
}) => {
  const { getSetupFiles } = await import('../utils/getSetupFiles');
  if (nodeProjects.length === 0) {
    return {
      list: [],
      getSourceMap: async (_name: string) => null,
      close: async () => {},
    };
  }

  const setupFiles = Object.fromEntries(
    nodeProjects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [environmentName, getSetupFiles(setupFiles, rootPath)];
    }),
  );

  const globalSetupFiles = Object.fromEntries(
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { globalSetup },
      } = project;

      return [environmentName, getSetupFiles(globalSetup, rootPath)];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    globTestSourceEntries,
    globalSetupFiles,
    isWatchMode: false,
    inspectedConfig: {
      ...context.normalizedConfig,
      projects: nodeProjects.map((p) => p.normalizedConfig),
    },
    setupFiles,
    rsbuildInstance,
    rootPath: context.rootPath,
  });

  const pool = await createPool({
    context,
  });

  const updateSnapshot = context.snapshotManager.options.updateSnapshot;

  const returns = await Promise.all(
    nodeProjects.map(async (project) => {
      const {
        entries,
        setupEntries,
        globalSetupEntries,
        getSourceMaps,
        getAssetFiles,
        assetNames,
      } = await getRsbuildStats({ environmentName: project.environmentName });

      if (
        entries.length &&
        globalSetupEntries.length &&
        !project._globalSetups
      ) {
        project._globalSetups = true;
        const files = globalSetupEntries.flatMap((e) => e.files!);
        const assetFiles = await getAssetFiles(files);

        const sourceMaps = await getSourceMaps(files);

        const { success, errors } = await runGlobalSetup({
          globalSetupEntries,
          assetFiles,
          sourceMaps,
          interopDefault: true,
          outputModule: project.outputModule,
        });
        if (!success) {
          return {
            list: [],
            errors,
            assetNames,
            getSourceMaps: () => null,
          };
        }
      }

      const list = await pool.collectTests({
        entries,
        setupEntries,
        getAssetFiles,
        getSourceMaps,
        project,
        updateSnapshot,
      });

      return {
        list,
        getSourceMaps,
        assetNames,
      };
    }),
  );

  return {
    list: returns.flatMap((r) => r.list),
    errors: returns.flatMap((r) => r.errors || []),
    getSourceMap: async (name: string) => {
      const resource = returns.find((r) => r.assetNames.includes(name));
      return (await resource?.getSourceMaps([name]))?.[name];
    },
    close: async () => {
      await runGlobalTeardown();
      await closeServer();
      await pool.close();
    },
  };
};

/**
 * Collect tests from browser mode projects using headless browser.
 */
const collectBrowserTests = async ({
  context,
  browserProjects,
  shardedEntries,
}: {
  context: RstestContext;
  browserProjects: ProjectContext[];
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
}): Promise<{
  list: ListCommandResult[];
  close: () => Promise<void>;
}> => {
  if (browserProjects.length === 0) {
    return {
      list: [],
      close: async () => {},
    };
  }

  const { loadBrowserModule } = await import('./browserLoader');
  // Pass project roots to resolve @rstest/browser from project-specific node_modules
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, listBrowserTests } = await loadBrowserModule({
    projectRoots,
  });
  validateBrowserConfig(context);
  return listBrowserTests(context, { shardedEntries });
};

const collectTestFiles = async ({
  context,
  globTestSourceEntries,
}: {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
}) => {
  const list: ListCommandResult[] = [];
  for (const project of context.projects) {
    const files = await globTestSourceEntries(project.environmentName);
    list.push(
      ...Object.values(files).map((testPath) => ({
        testPath,
        project: project.name,
        tests: [],
      })),
    );
  }
  return {
    close: async () => {},
    errors: [],
    list,
    getSourceMap: async (_name: string) => null,
  };
};

/**
 * Collect all tests by separating browser and node mode projects.
 */
const collectAllTests = async ({
  context,
  globTestSourceEntries,
  shardedEntries,
}: {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
}): Promise<{
  errors?: FormattedError[];
  list: ListCommandResult[];
  getSourceMap: (name: string) => Promise<string | null | undefined>;
  close: () => Promise<void>;
}> => {
  // Separate browser and node mode projects
  const browserProjects = context.projects.filter(
    (p) => p.normalizedConfig.browser.enabled,
  );
  const nodeProjects = context.projects.filter(
    (p) => !p.normalizedConfig.browser.enabled,
  );

  // Collect from both in parallel
  const [nodeResult, browserResult] = await Promise.all([
    collectNodeTests({
      context,
      nodeProjects,
      globTestSourceEntries,
    }),
    collectBrowserTests({
      context,
      browserProjects,
      shardedEntries,
    }),
  ]);

  return {
    errors: nodeResult.errors,
    list: [...nodeResult.list, ...browserResult.list],
    getSourceMap: nodeResult.getSourceMap,
    close: async () => {
      await Promise.all([nodeResult.close(), browserResult.close()]);
    },
  };
};

export async function listTests(
  context: RstestContext,
  { filesOnly, json, printLocation, includeSuites }: ListCommandOptions,
): Promise<ListCommandResult[]> {
  const { rootPath } = context;
  const { shard } = context.normalizedConfig;

  const shardedEntries = await resolveShardedEntries(context);
  const testEntries: Record<string, Record<string, string>> = {};
  let shardedBrowserEntries:
    | Map<string, { entries: Record<string, string> }>
    | undefined;

  if (shard && shardedEntries) {
    for (const [key, value] of shardedEntries.entries()) {
      testEntries[key] = value.entries;
    }

    shardedBrowserEntries = new Map();
    for (const p of context.projects.filter(
      (p) => p.normalizedConfig.browser.enabled,
    )) {
      shardedBrowserEntries.set(p.environmentName, {
        entries: testEntries[p.environmentName] || {},
      });
    }
  }

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (testEntries[name]) {
      return testEntries[name];
    }
    const { include, exclude, includeSource, root } = context.projects.find(
      (p) => p.environmentName === name,
    )!.normalizedConfig;

    const entries = await getTestEntries({
      include,
      exclude: exclude.patterns,
      rootPath,
      projectRoot: root,
      fileFilters: context.fileFilters || [],
      includeSource,
    });

    testEntries[name] = entries;

    return entries;
  };

  const {
    list,
    close,
    getSourceMap,
    errors = [],
  } = filesOnly
    ? await collectTestFiles({
        context,
        globTestSourceEntries,
      })
    : await collectAllTests({
        context,
        globTestSourceEntries,
        shardedEntries: shardedBrowserEntries,
      });

  const tests: {
    file: string;
    name?: string;
    project?: string;
    location?: Location;
    type: 'file' | 'suite' | 'case';
  }[] = [];

  const traverseTests = (test: Test) => {
    if (['skip', 'todo'].includes(test.runMode)) {
      return;
    }

    if (
      test.type === 'case' ||
      (includeSuites && test.type === 'suite' && test.name !== ROOT_SUITE_NAME)
    )
      tests.push({
        file: test.testPath,
        name: getTaskNameWithPrefix(test),
        location: test.location,
        type: test.type,
        project: showProject ? test.project : undefined,
      });

    if (test.type === 'suite') {
      for (const child of test.tests) {
        traverseTests(child);
      }
    }
  };

  const hasError = list.some((file) => file.errors?.length) || errors.length;
  const showProject = context.projects.length > 1;

  if (hasError) {
    const { printError } = await import('../utils/error');
    process.exitCode = 1;
    for (const file of list) {
      const relativePath = relative(rootPath, file.testPath);

      if (file.errors?.length) {
        //  FAIL  tests/index.test.ts
        logger.log(`${bgColor('bgRed', ' FAIL ')} ${relativePath}`);

        for (const error of file.errors) {
          await printError(
            error,
            async (name) => {
              const sourceMap = await getSourceMap(name);
              return sourceMap ? JSON.parse(sourceMap) : null;
            },
            rootPath,
          );
        }
      }
    }

    if (errors.length) {
      const { printError } = await import('../utils/error');
      for (const error of errors || []) {
        logger.stderr(bgColor('bgRed', ' Unhandled Error '));
        await printError(
          error,
          async (name) => {
            const sourceMap = await getSourceMap(name);
            return sourceMap ? JSON.parse(sourceMap) : null;
          },
          rootPath,
        );
      }
    }

    await close();
    return list;
  }

  for (const file of list) {
    if (filesOnly) {
      if (showProject) {
        tests.push({
          file: file.testPath,
          project: file.project,
          type: 'file',
        });
      } else {
        tests.push({
          file: file.testPath,
          type: 'file',
        });
      }
      continue;
    }
    for (const test of file.tests) {
      traverseTests(test);
    }
  }

  if (json && json !== 'false') {
    const content = JSON.stringify(tests, null, 2);
    if (json !== true && json !== 'true') {
      const jsonPath = isAbsolute(json) ? json : join(rootPath, json);
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, content);
    } else {
      logger.log(content);
    }
  } else {
    for (const test of tests) {
      let shortPath = relative(rootPath, test.file);
      if (test.location && printLocation) {
        shortPath = `${shortPath}:${test.location.line}:${test.location.column}`;
      }
      logger.log(
        test.name
          ? `${color.dim(`${shortPath} > `)}${test.name}`
          : prettyTestPath(shortPath),
      );
    }
  }

  await close();

  return list;
}
