import { fork } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isBuiltin, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRsbuild, type Rspack, type RsbuildConfig } from '@rsbuild/core';
import type {
  InternalProjectContext,
  TestEnvironmentModuleReference,
} from '../../types';
import { ADDITIONAL_NODE_BUILTINS, logger } from '../../utils';
import { getHostExecArgv } from '../../utils/workers';
import {
  importMetaHook,
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from '../../runtime/worker/runtimeHooks';
import {
  createTestEnvironmentLoadError,
  environmentDependencyPackages,
  formatTestEnvironmentPrebundleFallbackWarning,
  getTestEnvironmentResolutionRoots,
  type EnvironmentDependencyName,
} from './envDependencies';
import { getMockRstestPluginOptions } from '../plugins/mockBuild';

export type PreparedTestEnvironmentModules = {
  modules: ReadonlyMap<string, TestEnvironmentModuleReference>;
  update: (projects: InternalProjectContext[]) => Promise<void>;
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

export const resolveTestEnvironmentModule = (
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
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("file:") ||
    __rstestModule.isBuiltin(specifier)
  ) {
    return import(specifier, attributes);
  }
  const nativeResolved = __rstestModule
    .createRequire(origin || import.meta.url)
    .resolve(specifier);
  const resolved = __rstestModule.isBuiltin(nativeResolved)
    ? nativeResolved
    : __rstestPathToFileURL(nativeResolved).href;
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
  // cspell:word acemir
  // jsdom 27-28 use @acemir/cssom's undeclared optional cssstyle import.
  // Bundling can change that phantom dependency's resolution and break
  // getComputedStyle(), so `auto` keeps those majors on the native path.
  jsdom: [
    { from: 15, to: 26 },
    { from: 29, to: 30 },
  ],
  'happy-dom': [{ from: 20, to: 21 }],
};

const getPackageMajorVersion = async ({
  packageName,
  resolvedPath,
}: {
  packageName: string;
  resolvedPath: string;
}): Promise<number | undefined> => {
  let currentDirectory = dirname(resolvedPath);

  while (true) {
    let packageJsonSource: string;
    try {
      packageJsonSource = await readFile(
        join(currentDirectory, 'package.json'),
        'utf8',
      );
    } catch {
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        return;
      }
      currentDirectory = parentDirectory;
      continue;
    }

    try {
      const packageJson = JSON.parse(packageJsonSource) as {
        name?: string;
        version?: string;
      };
      if (packageJson.name === packageName) {
        const major = packageJson.version?.match(/^(\d+)(?:\.|$)/)?.[1];
        return major === undefined ? undefined : Number(major);
      }
      // An unnamed nested package.json may only define module semantics, so
      // keep looking for the owning package. A differently named manifest
      // means the resolved entry does not belong to the requested dependency.
      if (packageJson.name !== undefined) {
        return;
      }
    } catch {
      return;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return;
    }
    currentDirectory = parentDirectory;
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

  const isNodeBuiltin =
    isBuiltin(request) ||
    ADDITIONAL_NODE_BUILTINS.some((builtin) =>
      typeof builtin === 'string' ? builtin === request : builtin.test(request),
    );
  if (isNodeBuiltin) {
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
  if (dependencyType === 'commonjs') {
    callback(undefined, resolvedPath ?? request, 'commonjs');
    return;
  }

  // An absolute Windows path is not a valid ESM specifier. Keep native
  // dependencies portable when Rspack emits the external import.
  callback(
    undefined,
    resolvedPath ? pathToFileURL(resolvedPath).href : request,
    'module-import',
  );
};

const createTestEnvironmentBuildConfig = ({
  entryPath,
  outputPath,
  projectRoot,
  reference,
}: {
  entryPath: string;
  outputPath: string;
  projectRoot: string;
  reference: TestEnvironmentModuleReference;
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
      config.resolve ??= {};
      // Published test environments do not rely on the consuming project's
      // TypeScript paths. Avoid traversing its extends/references graph while
      // building the isolated environment bundle.
      delete config.resolve.tsConfig;
      if (reference.name === 'jsdom') {
        config.resolve.alias = {
          ...config.resolve.alias,
          jsdom: dirname(dirname(reference.resolvedPath)),
        };
      }
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
        nodeEnv: false,
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
          // Environment bundles contain no test mocks, so skip the mock-hoist asset scan.
          hoistMockModule: false,
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

const createBundleEntrySource = async (
  reference: TestEnvironmentModuleReference,
): Promise<string> => {
  const moduleUrl = JSON.stringify(pathToFileURL(reference.resolvedPath).href);
  if (reference.name !== 'jsdom') {
    return `export * from ${moduleUrl};\n`;
  }

  const major = await getPackageMajorVersion({
    packageName: reference.packageName,
    resolvedPath: reference.resolvedPath,
  });
  if (major === undefined || major < 29) {
    return `export * from 'jsdom';\n`;
  }

  let blobConverterPath: string;
  try {
    blobConverterPath = createRequire(reference.resolvedPath).resolve(
      'jsdom/lib/generated/idl/Blob',
    );
  } catch {
    return `export * from 'jsdom';\n`;
  }

  const blobConverterModuleUrl = JSON.stringify(
    pathToFileURL(blobConverterPath).href,
  );
  return `export * from 'jsdom';\nexport { convert as __rstestBlobConvert } from ${blobConverterModuleUrl};\n`;
};

type BuildTestEnvironmentModuleOptions = {
  bundleId: number;
  projectRoot: string;
  reference: TestEnvironmentModuleReference;
  tempRoot: string;
};

export const buildTestEnvironmentModule = async ({
  bundleId,
  projectRoot,
  reference,
  tempRoot,
}: BuildTestEnvironmentModuleOptions): Promise<string> => {
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
  await writeFile(inputPath, await createBundleEntrySource(reference));

  const rsbuild = await createRsbuild({
    callerName: 'rstest',
    config: createTestEnvironmentBuildConfig({
      entryPath: inputPath,
      outputPath,
      projectRoot,
      reference,
    }),
  });
  rsbuild.logger.level = 'error';

  const result = await rsbuild.build();
  await result.close();
  const bundlePath = join(outputPath, 'environment.mjs');
  // The OS temp path can contain an alias (macOS exposes /var as /private/var),
  // while Node's ESM stack uses the canonical path. Resolve it once here so
  // workers and source-map-support identify the generated file consistently.
  return realpath(bundlePath);
};

export type PrebundleWorkerMessage = { bundlePath: string } | { error: string };

// Rspack's native allocator keeps its pages after a build, so building in this
// process would raise its peak memory for the whole run. The child exits as
// soon as the build finishes and returns that memory to the OS. It inherits
// the host's Node flags and NODE_OPTIONS like a pool worker does.
const buildTestEnvironmentModuleInChild = (
  options: BuildTestEnvironmentModuleOptions,
  signal: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = fork(
      join(dirname(fileURLToPath(import.meta.url)), 'prebundleWorker.js'),
      [JSON.stringify(options)],
      {
        execArgv: getHostExecArgv('forks', process.execArgv),
        signal,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    let message: PrebundleWorkerMessage | undefined;
    child.once('message', (value: PrebundleWorkerMessage) => {
      message = value;
    });
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    // `close` fires exactly once, after the process is gone, including when
    // spawning or aborting failed with an `error` first.
    child.once('close', (code, exitSignal) => {
      if (message && 'bundlePath' in message) {
        resolve(message.bundlePath);
      } else {
        reject(
          spawnError ??
            new Error(
              message?.error ??
                `The prebundle process exited with ${exitSignal ?? `code ${code}`}.`,
            ),
        );
      }
    });
  });

const shouldPrebundle = async ({
  name,
  packageName,
  project,
  resolvedPath,
}: {
  name: EnvironmentDependencyName;
  packageName: string;
  project: InternalProjectContext;
  resolvedPath: string;
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
    resolvedPath,
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
  buildModule = buildTestEnvironmentModuleInChild,
}: {
  projects: InternalProjectContext[];
  rootPath: string;
  buildModule?: (
    options: BuildTestEnvironmentModuleOptions,
    signal: AbortSignal,
  ) => Promise<string>;
}): Promise<PreparedTestEnvironmentModules> => {
  const modules = new Map<string, TestEnvironmentModuleReference>();
  const bundlePaths = new Map<string, Promise<string | undefined>>();
  const abortController = new AbortController();
  let tempRoot: string | undefined;
  const cleanup = async (): Promise<void> => {
    abortController.abort();
    // A killed child must be gone before its output directory is removed.
    await Promise.all(bundlePaths.values());
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };

  const update = async (
    nextProjects: InternalProjectContext[],
  ): Promise<void> => {
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
          resolvedPath,
        }))
      ) {
        continue;
      }

      const bundleKey = resolvedPath;
      let bundlePathPromise = bundlePaths.get(bundleKey);
      if (!bundlePathPromise) {
        tempRoot ??= await mkdtemp(join(tmpdir(), 'rstest-test-environments-'));
        bundlePathPromise = buildModule(
          {
            bundleId: bundlePaths.size,
            projectRoot: project.rootPath,
            reference,
            tempRoot,
          },
          abortController.signal,
        ).catch((error: unknown) => {
          if (!abortController.signal.aborted) {
            logger.warn(
              formatTestEnvironmentPrebundleFallbackWarning(packageName, error),
            );
          }
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
