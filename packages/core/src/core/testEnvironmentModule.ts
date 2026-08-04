import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isBuiltin, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRsbuild, type Rspack, type RsbuildConfig } from '@rsbuild/core';
import type { ProjectContext, TestEnvironmentModuleReference } from '../types';
import { logger } from '../utils';
import {
  importMetaHook,
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from '../runtime/worker/runtimeHooks';
import {
  createTestEnvironmentLoadError,
  environmentDependencyPackages,
  getTestEnvironmentResolutionRoots,
  type EnvironmentDependencyName,
} from './envDependencies';
import { getMockRstestPluginOptions } from './plugins/mockBuild';

export type PreparedTestEnvironmentModules = {
  modules: ReadonlyMap<string, TestEnvironmentModuleReference>;
  update: (projects: ProjectContext[]) => Promise<void>;
  cleanup: () => Promise<void>;
};

const resolveFromRoot = (
  specifier: string,
  root: string,
): string | undefined => {
  try {
    return createRequire(join(root, 'package.json')).resolve(specifier);
  } catch {
    return;
  }
};

const resolveTestEnvironmentModule = (
  specifier: string,
  projectRoot: string,
  root: string,
): string | undefined => {
  for (const resolutionRoot of getTestEnvironmentResolutionRoots(
    projectRoot,
    root,
  )) {
    const resolved = resolveFromRoot(specifier, resolutionRoot);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
};

const nativeImportBanner = `import __rstestModule from "node:module";
import { pathToFileURL as __rstestPathToFileURL } from "node:url";
const require = __rstestModule.createRequire(import.meta.url);
import.meta.${RSTEST_REQUIRE_RESOLVE_HOOK} = (specifier, optionsOrOrigin, maybeOrigin) => {
  const options = typeof optionsOrOrigin === "string" ? undefined : optionsOrOrigin;
  const origin = typeof optionsOrOrigin === "string" ? optionsOrOrigin : maybeOrigin;
  return __rstestModule.createRequire(origin || import.meta.url).resolve(specifier, options);
};
import.meta.${RSTEST_DYNAMIC_IMPORT_HOOK} = (specifier, attributes, origin) => {
  const resolved = specifier.startsWith("node:") || specifier.startsWith("file:")
    ? specifier
    : __rstestPathToFileURL(
        __rstestModule.createRequire(origin || import.meta.url).resolve(specifier),
      ).href;
  return import(resolved, attributes);
};
`;

const optionalNativeExternals = new Set(['canvas']);

type MajorVersionRange = {
  from: number;
  to: number;
};

const autoPrebundleMajorRanges: Record<
  EnvironmentDependencyName,
  readonly MajorVersionRange[]
> = {
  // Future majors stay on the native path under `auto` until their runtime
  // edge cases have been covered by the environment regression matrix. Users
  // can explicitly set `prebundle: true` to override this compatibility gate.
  // jsdom 27-28 use @acemir/cssom's undeclared optional cssstyle import.
  // Bundling can change that phantom dependency's resolution and break
  // getComputedStyle(), so `auto` keeps those majors on the native path.
  jsdom: [
    { from: 15, to: 26 },
    { from: 29, to: 30 },
  ],
  'happy-dom': [{ from: 20, to: 20 }],
};

const getPackageMajorVersion = async ({
  packageName,
  projectRoot,
  root,
}: {
  packageName: string;
  projectRoot: string;
  root: string;
}): Promise<number | undefined> => {
  const packageJsonPath = resolveTestEnvironmentModule(
    `${packageName}/package.json`,
    projectRoot,
    root,
  );
  if (!packageJsonPath) {
    return;
  }

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    const major = packageJson.version?.match(/^(\d+)(?:\.|$)/)?.[1];
    return major === undefined ? undefined : Number(major);
  } catch {
    return;
  }
};

const canAutoPrebundle = (
  name: EnvironmentDependencyName,
  major: number,
): boolean =>
  autoPrebundleMajorRanges[name].some(
    ({ from, to }) => major >= from && major <= to,
  );

const testEnvironmentExternal = (
  { context, dependencyType, request }: Rspack.ExternalItemFunctionData,
  callback: (
    error?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
): void => {
  if (!request) {
    callback();
    return;
  }

  if (isBuiltin(request)) {
    callback(
      undefined,
      request,
      dependencyType === 'commonjs' ? 'commonjs' : 'module-import',
    );
    return;
  }

  if (!optionalNativeExternals.has(request) || !context) {
    callback();
    return;
  }

  const resolvedPath = resolveFromRoot(request, context);
  // jsdom 13-21 guard a static `require('canvas')` with a separate
  // `require.resolve()` check. Keep the unresolved request external so the
  // optional dependency remains a runtime decision instead of a build error.
  callback(
    undefined,
    resolvedPath ?? request,
    dependencyType === 'commonjs' ? 'commonjs' : 'module-import',
  );
};

const createTestEnvironmentBuildConfig = ({
  entryPath,
  outputPath,
  projectRoot,
}: {
  entryPath: string;
  outputPath: string;
  projectRoot: string;
}): RsbuildConfig => ({
  root: projectRoot,
  source: {
    entry: {
      environment: entryPath,
    },
  },
  output: {
    target: 'node',
    module: true,
    cleanDistPath: true,
    distPath: {
      root: outputPath,
    },
    filename: {
      js: 'environment.mjs',
    },
    minify: false,
    sourceMap: false,
  },
  tools: {
    rspack: (config, { rspack }) => {
      config.context = projectRoot;
      config.mode = 'development';
      config.externals = [testEnvironmentExternal];
      config.externalsPresets ??= {};
      config.externalsPresets.node = false;
      config.node = {
        ...config.node,
        __dirname: true,
        __filename: true,
      };
      config.output ??= {};
      config.output.iife = false;
      config.output.importFunctionName = importMetaHook(
        RSTEST_DYNAMIC_IMPORT_HOOK,
      );
      config.output.library = {
        type: 'module',
      };
      config.optimization = {
        ...config.optimization,
        runtimeChunk: false,
        splitChunks: false,
      };
      config.module ??= {};
      config.module.parser ??= {};
      config.module.parser.javascript = {
        ...config.module.parser.javascript,
        importDynamic: false,
        requireDynamic: false,
        requireAsExpression: false,
        requireResolve: false,
        url: false,
      };
      config.plugins ??= [];
      config.plugins.push(
        new rspack.experiments.RstestPlugin({
          ...getMockRstestPluginOptions({ rootPath: projectRoot }),
          injectDynamicImportOrigin: true,
          injectRequireResolveOrigin: {
            functionName: importMetaHook(RSTEST_REQUIRE_RESOLVE_HOOK),
          },
        }),
        new rspack.BannerPlugin({
          banner: nativeImportBanner,
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE - 1,
          raw: true,
          include: /\.mjs$/,
        }),
      );
    },
  },
});

const createBundleEntrySource = (
  reference: TestEnvironmentModuleReference,
): string => {
  const moduleUrl = JSON.stringify(pathToFileURL(reference.resolvedPath).href);
  return `export * from ${moduleUrl};\n`;
};

const buildTestEnvironmentModule = async ({
  bundleId,
  projectRoot,
  reference,
  tempRoot,
}: {
  bundleId: number;
  projectRoot: string;
  reference: TestEnvironmentModuleReference;
  tempRoot: string;
}): Promise<string> => {
  // Keep bundled third-party code under a node_modules segment. Besides
  // preserving its dependency provenance for Node diagnostics, this prevents
  // old jsdom internals such as bare `require('punycode')` from being reported
  // as application-owned deprecations merely because Rstest relocated them to
  // a top-level temporary directory.
  const environmentRoot = join(
    tempRoot,
    'node_modules',
    `test-environment-${bundleId}`,
  );
  const inputPath = join(environmentRoot, 'entry.mjs');
  const outputPath = join(environmentRoot, 'dist');
  await mkdir(environmentRoot, { recursive: true });
  await writeFile(inputPath, createBundleEntrySource(reference));

  const rsbuild = await createRsbuild({
    callerName: 'rstest',
    config: createTestEnvironmentBuildConfig({
      entryPath: inputPath,
      outputPath,
      projectRoot,
    }),
  });
  rsbuild.logger.level = 'error';

  const result = await rsbuild.build();
  await result.close();
  return join(outputPath, 'environment.mjs');
};

const shouldPrebundle = async ({
  name,
  packageName,
  project,
  rootPath,
}: {
  name: EnvironmentDependencyName;
  packageName: string;
  project: ProjectContext;
  rootPath: string;
}): Promise<boolean> => {
  const option = project.normalizedConfig.testEnvironment.prebundle ?? 'auto';
  if (option === true) {
    return true;
  }
  if (option === false) {
    return false;
  }

  const major = await getPackageMajorVersion({
    packageName,
    projectRoot: project.rootPath,
    root: rootPath,
  });
  if (major !== undefined && canAutoPrebundle(name, major)) {
    return true;
  }

  logger.debug(
    `Skipping automatic prebundle for unsupported ${packageName} major version ${major ?? 'unknown'}; falling back to its native entry.`,
  );
  return false;
};

export const prepareTestEnvironmentModules = async ({
  projects,
  rootPath,
}: {
  projects: ProjectContext[];
  rootPath: string;
}): Promise<PreparedTestEnvironmentModules> => {
  const modules = new Map<string, TestEnvironmentModuleReference>();
  const bundlePaths = new Map<string, Promise<string | undefined>>();
  let tempRoot: string | undefined;
  const cleanup = async (): Promise<void> => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };

  const update = async (nextProjects: ProjectContext[]): Promise<void> => {
    const nextModules = new Map<string, TestEnvironmentModuleReference>();

    for (const project of nextProjects) {
      const name = project.normalizedConfig.testEnvironment.name;
      if (name === 'node') {
        continue;
      }

      const packageName =
        environmentDependencyPackages[name as EnvironmentDependencyName];
      if (!packageName) {
        continue;
      }
      const resolvedPath = resolveTestEnvironmentModule(
        packageName,
        project.rootPath,
        rootPath,
      );
      if (!resolvedPath) {
        throw createTestEnvironmentLoadError(
          packageName,
          project.rootPath,
          name,
        );
      }

      const reference: TestEnvironmentModuleReference = {
        name: name as EnvironmentDependencyName,
        packageName,
        resolvedPath,
      };
      nextModules.set(project.environmentName, reference);

      if (
        !(await shouldPrebundle({
          name,
          packageName,
          project,
          rootPath,
        }))
      ) {
        continue;
      }

      const bundleKey = resolvedPath;
      let bundlePathPromise = bundlePaths.get(bundleKey);
      if (!bundlePathPromise) {
        tempRoot ??= await mkdtemp(join(tmpdir(), 'rstest-test-environments-'));
        bundlePathPromise = buildTestEnvironmentModule({
          bundleId: bundlePaths.size,
          projectRoot: project.rootPath,
          reference,
          tempRoot,
        }).catch((error: unknown) => {
          logger.debug(
            `Failed to prebundle test environment ${packageName}; falling back to its native entry: ${String(error)}`,
          );
          return undefined;
        });
        bundlePaths.set(bundleKey, bundlePathPromise);
      }

      reference.bundlePath = await bundlePathPromise;
      if (reference.bundlePath) {
        const size = await stat(reference.bundlePath)
          .then((stats) => stats.size)
          .catch(() => undefined);
        logger.debug(
          `bundled test environment ${packageName} from ${resolvedPath}${size === undefined ? '' : ` (${(size / 1024 / 1024).toFixed(2)} MB)`}`,
        );
      }
    }

    // The pool keeps this Map for its entire lifetime. Replace its contents
    // only after every next reference is ready so a failed watch-plan refresh
    // leaves the previous runnable plan intact.
    modules.clear();
    for (const [environmentName, reference] of nextModules) {
      modules.set(environmentName, reference);
    }
  };

  try {
    await update(projects);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    modules,
    update,
    cleanup,
  };
};
