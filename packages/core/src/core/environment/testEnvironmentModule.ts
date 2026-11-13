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
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createRsbuild,
  rspack as rspackExports,
  version as rsbuildVersion,
  type Rspack,
  type RsbuildConfig,
} from '@rsbuild/core';
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
import {
  findReusableEntry,
  getBundlePath,
  hashParts,
  isEntryValid,
  pruneCache,
  publishEntry,
  TEST_ENVIRONMENT_CACHE_DIRECTORY,
  touchEntry,
  writeManifest,
  type ExternalResolution,
} from './testEnvironmentCache';

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

const getPackageVersion = async ({
  packageName,
  resolvedPath,
}: {
  packageName: string;
  resolvedPath: string;
}): Promise<string | undefined> => {
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
        return packageJson.version;
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

const getPackageMajorVersion = async (options: {
  packageName: string;
  resolvedPath: string;
}): Promise<number | undefined> => {
  const major = (await getPackageVersion(options))?.match(
    /^(\d+)(?:\.|$)/,
  )?.[1];
  return major === undefined ? undefined : Number(major);
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
  recordResolution?: (resolution: ExternalResolution) => void,
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
  // The emitted external depends on whether the optional package resolves, so
  // a cached bundle must be rebuilt when that answer changes.
  recordResolution?.({ context, request, resolved: resolvedPath ?? null });
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

/** What a build read, recorded to decide later whether its output is stale. */
type BuildInputs = {
  files: Set<string>;
  missing: Set<string>;
  externals: Map<string, ExternalResolution>;
};

const createTestEnvironmentBuildConfig = ({
  entryPath,
  inputs,
  outputPath,
  projectRoot,
  reference,
}: {
  entryPath: string;
  inputs?: BuildInputs;
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
      config.externals = [
        (data, callback) =>
          testEnvironmentExternal(data, callback, (resolution) => {
            inputs?.externals.set(
              `${resolution.context}\0${resolution.request}`,
              resolution,
            );
          }),
      ];
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
      if (inputs) {
        config.plugins.push({
          name: 'rstest:record-environment-inputs',
          apply(compiler: Rspack.Compiler) {
            compiler.hooks.done.tap(
              'rstest:record-environment-inputs',
              (stats) => {
                for (const file of stats.compilation.fileDependencies) {
                  inputs.files.add(file);
                }
                for (const file of stats.compilation.missingDependencies) {
                  inputs.missing.add(file);
                }
              },
            );
          },
        });
      }
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

export type BuildTestEnvironmentModuleOptions = {
  /** Directory that receives `entry.mjs`, `dist/` and `manifest.json`. */
  environmentRoot: string;
  /** Generated entry source, also an input of the cache key. */
  entrySource: string;
  projectRoot: string;
  reference: TestEnvironmentModuleReference;
};

export const buildTestEnvironmentModule = async ({
  entrySource,
  environmentRoot,
  projectRoot,
  reference,
}: BuildTestEnvironmentModuleOptions): Promise<string> => {
  const inputPath = join(environmentRoot, 'entry.mjs');
  const outputPath = join(environmentRoot, 'dist');
  await mkdir(environmentRoot, { recursive: true });
  await writeFile(inputPath, entrySource);

  const inputs: BuildInputs = {
    files: new Set(),
    missing: new Set(),
    externals: new Map(),
  };
  const startedAt = Date.now();
  const rsbuild = await createRsbuild({
    callerName: 'rstest',
    config: createTestEnvironmentBuildConfig({
      entryPath: inputPath,
      inputs,
      outputPath,
      projectRoot,
      reference,
    }),
  });
  rsbuild.logger.level = 'error';

  const result = await rsbuild.build();
  await result.close();
  const bundlePath = join(outputPath, 'environment.mjs');
  // The build directory is private to this build and its name changes per
  // build; the generated entry inside it is covered by the cache key instead.
  const buildRoots = [environmentRoot, await realpath(environmentRoot)].map(
    (root) => `${root}${sep}`,
  );
  const isOutsideBuild = (path: string) =>
    !buildRoots.some((root) => path.startsWith(root));
  const changedFile = await writeManifest({
    bundleSize: (await stat(bundlePath)).size,
    directory: environmentRoot,
    externals: [...inputs.externals.values()],
    files: [...inputs.files].filter(isOutsideBuild),
    missing: [...inputs.missing].filter(isOutsideBuild),
    startedAt,
  });
  // Without a manifest the output cannot be revalidated, so it is not cached.
  if (changedFile) {
    logger.debug(
      `the test environment prebundle will not be cached: ${changedFile} was modified during the build or has a future mtime`,
    );
  }
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

// Everything but the entry source and the package identity that decides the
// bundle's bytes. The function sources cover local edits of an unreleased
// build; released builds differ through RSTEST_VERSION.
const getBuildPipelineFingerprint = (projectRoot: string): string =>
  hashParts({
    banner: nativeImportBanner,
    buildConfig: String(createTestEnvironmentBuildConfig),
    external: String(testEnvironmentExternal),
    mock: getMockRstestPluginOptions({ rootPath: projectRoot }),
    rsbuild: rsbuildVersion,
    rspack: rspackExports.rspackVersion,
    rstest: RSTEST_VERSION,
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
  // Build directories inside a cache that were never published.
  const unpublishedDirectories = new Set<string>();
  // Cache entries this run uses, kept fresh in watch mode.
  const usedEntries = new Set<string>();
  const pruning: Promise<void>[] = [];
  const cleanup = async (): Promise<void> => {
    abortController.abort();
    // A killed child must be gone before its output directory is removed.
    await Promise.all(bundlePaths.values());
    await Promise.all(pruning);
    // Published cache entries outlive the run; only this run's own temporary
    // directories are removed.
    await Promise.all([
      ...[...unpublishedDirectories].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
      tempRoot && rm(tempRoot, { recursive: true, force: true }),
    ]);
  };

  const obtainBundle = async ({
    bundleId,
    projectRoot,
    reference,
  }: {
    bundleId: number;
    projectRoot: string;
    reference: TestEnvironmentModuleReference;
  }): Promise<string> => {
    const entrySource = await createBundleEntrySource(reference);
    const cacheBase = join(
      projectRoot,
      'node_modules',
      '.cache',
      TEST_ENVIRONMENT_CACHE_DIRECTORY,
    );
    const keyDirectory = join(
      cacheBase,
      `${reference.name}-${hashParts({
        entrySource,
        packageName: reference.packageName,
        packageVersion: await getPackageVersion(reference),
        pipeline: getBuildPipelineFingerprint(projectRoot),
        projectRoot,
        resolvedPath: reference.resolvedPath,
      })}`,
    );

    const lookupStart = performance.now();
    const reusable = await findReusableEntry(keyDirectory, resolveFromRoot);
    if (reusable) {
      usedEntries.add(reusable);
      logger.debug(
        `reusing cached test environment prebundle for ${reference.packageName} from ${reusable} (looked up in ${(performance.now() - lookupStart).toFixed(1)} ms)`,
      );
      return realpath(getBundlePath(reusable));
    }

    let buildRoot: string | undefined;
    try {
      await mkdir(cacheBase, { recursive: true });
      buildRoot = await mkdtemp(join(cacheBase, '.tmp-'));
      unpublishedDirectories.add(buildRoot);
    } catch (error) {
      logger.debug(
        `test environment prebundle cache is unavailable at ${cacheBase}; using a temporary directory: ${String(error)}`,
      );
    }

    if (!buildRoot) {
      tempRoot ??= await mkdtemp(join(tmpdir(), 'rstest-test-environments-'));
      return buildModule(
        {
          // Keep bundled third-party code under a node_modules segment.
          // Besides preserving its dependency provenance for Node
          // diagnostics, this prevents old jsdom internals such as bare
          // `require('punycode')` from being reported as application-owned
          // deprecations merely because Rstest relocated them to a top-level
          // temporary directory. The cache path above has one as well.
          environmentRoot: join(
            tempRoot,
            'node_modules',
            `test-environment-${bundleId}`,
          ),
          entrySource,
          projectRoot,
          reference,
        },
        abortController.signal,
      );
    }

    const builtBundlePath = await buildModule(
      { environmentRoot: buildRoot, entrySource, projectRoot, reference },
      abortController.signal,
    );

    // Publish only when the build recorded inputs that are still unchanged.
    // Otherwise the bundle stays in its private directory, which is removed
    // on cleanup.
    if (!(await isEntryValid(buildRoot, resolveFromRoot))) {
      logger.debug(
        `test environment prebundle for ${reference.packageName} was not cached`,
      );
      return builtBundlePath;
    }
    // A rename keeps the directory's mtime, so mark the build as just used
    // first: a concurrent prune must see the new entry as in use.
    await touchEntry(buildRoot);
    let directory: string;
    try {
      directory = await publishEntry(buildRoot, keyDirectory);
    } catch (error) {
      logger.debug(
        `test environment prebundle for ${reference.packageName} could not be published: ${String(error)}`,
      );
      return builtBundlePath;
    }
    unpublishedDirectories.delete(buildRoot);
    usedEntries.add(directory);
    pruning.push(pruneCache(cacheBase));
    logger.debug(
      `published test environment prebundle for ${reference.packageName} at ${directory}`,
    );
    return realpath(getBundlePath(directory));
  };

  const update = async (
    nextProjects: InternalProjectContext[],
  ): Promise<void> => {
    const nextModules = new Map<string, TestEnvironmentModuleReference>();
    await Promise.all([...usedEntries].map(touchEntry));

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
        bundlePathPromise = obtainBundle({
          bundleId: bundlePaths.size,
          projectRoot: project.rootPath,
          reference,
        }).catch((error: unknown) => {
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

/**
 * Await the dev server and the prepared environment modules, which are built
 * concurrently. When one side fails, release the other before rethrowing.
 */
export const settleServerAndTestEnvironmentModules = async <
  Server extends { closeServer: () => Promise<void> },
>({
  modules,
  server,
}: {
  modules: Promise<PreparedTestEnvironmentModules>;
  server: Promise<Server>;
}): Promise<{
  server: Server;
  testEnvironmentModules: PreparedTestEnvironmentModules;
}> => {
  const [modulesResult, serverResult] = await Promise.allSettled([
    modules,
    server,
  ]);
  if (serverResult.status === 'rejected') {
    if (modulesResult.status === 'fulfilled') {
      await modulesResult.value.cleanup();
    }
    throw serverResult.reason;
  }
  if (modulesResult.status === 'rejected') {
    await serverResult.value.closeServer();
    throw modulesResult.reason;
  }
  return {
    server: serverResult.value,
    testEnvironmentModules: modulesResult.value,
  };
};
