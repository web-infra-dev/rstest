import { existsSync } from 'node:fs';
import { createRequire as createNativeRequire } from 'node:module';
import type { ImportAttributes } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'pathe';
import type { AssetFiles } from '../../types/worker';
import { getAssetBuffer, getAssetText } from '../../utils/assetFiles';
import { logger } from '../../utils/logger';
import { clearCacheCleaners, clearSyntheticModuleCache } from './interop';
import {
  finalizeDynamicImport,
  loadWasm,
  resolveImportSpecifier,
} from './resolveDynamicImport';
import {
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from './runtimeHooks';
import { getVmExternalModules } from './vmExternalModules';

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const VM_TIMER_EXPORTS = new Set([
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
]);

const getAssetName = (
  assetFiles: AssetFiles,
  filePath: unknown,
): string | undefined => {
  if (typeof filePath === 'string') {
    const name = path.normalize(filePath);
    return assetFiles[name] === undefined ? undefined : name;
  }
  if (filePath instanceof URL && filePath.protocol === 'file:') {
    const name = path.normalize(fileURLToPath(filePath));
    return assetFiles[name] === undefined ? undefined : name;
  }
  return undefined;
};

const formatAssetContent = (
  assetFiles: AssetFiles,
  name: string,
  options?: unknown,
) => {
  const buffer = getAssetBuffer(assetFiles, name);
  const encoding =
    typeof options === 'string'
      ? options
      : options && typeof options === 'object' && 'encoding' in options
        ? options.encoding
        : undefined;
  return typeof encoding === 'string'
    ? buffer.toString(encoding as BufferEncoding)
    : buffer;
};

const createVirtualFsAssetProxy = (
  fsModule: typeof import('node:fs'),
  assetFiles: AssetFiles,
): typeof import('node:fs') =>
  new Proxy(fsModule, {
    get(target, property, receiver) {
      if (property === 'existsSync') {
        return (filePath: unknown) =>
          getAssetName(assetFiles, filePath) !== undefined ||
          target.existsSync(
            filePath as Parameters<typeof target.existsSync>[0],
          );
      }

      if (property === 'readFile') {
        return (
          filePath: unknown,
          optionsOrCallback: unknown,
          maybeCallback?: unknown,
        ) => {
          const callback =
            typeof optionsOrCallback === 'function'
              ? optionsOrCallback
              : maybeCallback;
          const name = getAssetName(assetFiles, filePath);

          if (name !== undefined && typeof callback === 'function') {
            queueMicrotask(() =>
              callback(
                null,
                formatAssetContent(assetFiles, name, optionsOrCallback),
              ),
            );
            return;
          }

          return Reflect.apply(
            target.readFile,
            target,
            [filePath, optionsOrCallback, maybeCallback].filter(
              (value) => value !== undefined,
            ),
          );
        };
      }

      if (property === 'readFileSync') {
        return (filePath: unknown, options?: unknown) => {
          const name = getAssetName(assetFiles, filePath);
          if (name !== undefined) {
            return formatAssetContent(assetFiles, name, options);
          }
          return target.readFileSync(
            filePath as Parameters<typeof target.readFileSync>[0],
            options as Parameters<typeof target.readFileSync>[1],
          );
        };
      }

      if (property === 'promises') {
        return new Proxy(target.promises, {
          get(promisesTarget, promisesProperty, promisesReceiver) {
            if (promisesProperty === 'readFile') {
              return (filePath: unknown, options?: unknown) => {
                const name = getAssetName(assetFiles, filePath);
                return name === undefined
                  ? Reflect.apply(promisesTarget.readFile, promisesTarget, [
                      filePath,
                      options,
                    ])
                  : Promise.resolve(
                      formatAssetContent(assetFiles, name, options),
                    );
              };
            }
            return Reflect.get(
              promisesTarget,
              promisesProperty,
              promisesReceiver,
            );
          },
        });
      }

      return Reflect.get(target, property, receiver);
    },
  });

const defineRstestRequireResolve =
  ({
    testPath,
    distPath,
    assetFiles,
  }: {
    testPath: string;
    distPath: string;
    assetFiles: AssetFiles;
  }) =>
  (
    specifier: string,
    optionsOrOrigin?: string | { paths?: string[] },
    maybeOrigin?: string,
  ): string => {
    const options =
      typeof optionsOrOrigin === 'string' ? undefined : optionsOrOrigin;
    // `origin` is the absolute path of the source module that produced the
    // `require.resolve()` call, injected by rspack's `RstestPlugin` when
    // `injectRequireResolveOrigin` is enabled. Falling back keeps native
    // `require.resolve` semantics for un-rewritten calls.
    const origin =
      typeof optionsOrOrigin === 'string' ? optionsOrOrigin : maybeOrigin;
    const resolveBase = origin ?? testPath;

    const currentDirectory = path.dirname(origin ?? distPath);
    const joinedPath = isRelativePath(specifier)
      ? path.join(currentDirectory, specifier)
      : specifier;
    const normalizedPath = path.normalize(joinedPath);

    if (assetFiles[normalizedPath] !== undefined) {
      return normalizedPath;
    }

    return createNativeRequire(resolveBase).resolve(specifier, options);
  };

const createRequire = (
  filename: string,
  distPath: string,
  rstestContext: Record<string, any>,
  assetFiles: AssetFiles,
  interopDefault: boolean,
  virtualFsAssetFiles?: AssetFiles,
  vmContext?: vm.Context,
  cacheCompilation = false,
): NodeJS.Require => {
  const _require = (() => {
    try {
      // compat with some testPath may not be an available path but the third-party package name
      return createNativeRequire(filename);
    } catch {
      return createNativeRequire(distPath);
    }
  })();

  const loadTimersModule = (id: string): unknown => {
    const timersModule = _require(id) as Record<PropertyKey, unknown>;
    if (!vmContext) {
      return timersModule;
    }

    const runtimeGlobal = vm.runInContext('globalThis', vmContext) as Record<
      PropertyKey,
      unknown
    >;
    return new Proxy(timersModule, {
      get(target, property, receiver) {
        if (typeof property === 'string' && VM_TIMER_EXPORTS.has(property)) {
          return runtimeGlobal[property];
        }
        return Reflect.get(target, property, receiver);
      },
    });
  };

  const require = ((id: string) => {
    if (id === 'fs' || id === 'node:fs') {
      const fsModule = _require(id);
      return virtualFsAssetFiles
        ? createVirtualFsAssetProxy(fsModule, virtualFsAssetFiles)
        : fsModule;
    }

    if (vmContext && (id === 'timers' || id === 'node:timers')) {
      return loadTimersModule(id);
    }

    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(id)
      ? path.join(currentDirectory, id)
      : id;

    const assetName = getAssetName(assetFiles, joinedPath);

    if (assetName !== undefined) {
      try {
        return cacheableLoadModule({
          codeContent: getAssetText(assetFiles, assetName),
          testPath: joinedPath,
          distPath: joinedPath,
          rstestContext,
          assetFiles,
          interopDefault,
          virtualFsAssetFiles,
          vmContext,
          cacheCompilation,
        });
      } catch (err) {
        logger.error(
          `load file ${joinedPath} failed:\n`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (vmContext) {
      return getVmExternalModules(vmContext).require(id, filename);
    }
    const resolved = _require.resolve(id);
    return _require(resolved);
  }) as NodeJS.Require;
  const requireResolve = defineRstestRequireResolve({
    testPath: filename,
    distPath,
    assetFiles,
  }) as NodeJS.RequireResolve;
  requireResolve.paths = _require.resolve.paths.bind(_require.resolve);
  require.resolve = requireResolve;
  require.main = _require.main;
  return require;
};

const defineRstestDynamicImport =
  ({
    testPath,
    interopDefault,
    returnModule = false,
    vmContext,
  }: {
    returnModule?: boolean;
    testPath: string;
    interopDefault: boolean;
    vmContext?: vm.Context;
  }) =>
  async (
    specifier: string,
    importAttributes: ImportCallOptions,
    origin?: string,
  ) => {
    const modulePath = resolveImportSpecifier({ specifier, origin, testPath });

    // `.wasm` always resolves to an on-disk source file (wasmLoader.mjs rewrites
    // direct imports; `new URL(...)` resolves source-relative, #1455). rstest
    // instantiates it itself so the pattern is flag-free on every Node version.
    if (modulePath.endsWith('.wasm')) {
      const normalizedPath = path.normalize(
        modulePath.startsWith('file://')
          ? fileURLToPath(modulePath)
          : modulePath,
      );

      if (existsSync(normalizedPath)) {
        return loadWasm(normalizedPath, returnModule, vmContext);
      }
    }

    return finalizeDynamicImport({
      modulePath,
      importAttributes,
      interopDefault,
      returnModule,
      vmContext,
    });
  };

// Persistent asset map for the kept runtime chunk under `isolate: false` (the
// per-module hooks closed over this reference). Mirrors the ESM loader — see
// `loadEsModule.ts` for the full rationale.
const accumulatedAssetFiles: AssetFiles = {};

// Every shared runtime chunk this (possibly reused) worker has loaded under
// `isolate: false`. Mirrors the ESM loader — a reused worker can serve multiple
// projects (the pool has no environment affinity), so keeping a single id would
// let one project's teardown evict another's runtime chunk. Accumulate all and
// reset only on a full clear; see `loadEsModule.ts` for the full rationale.
const keptRuntimeChunks = new Set<string>();

// Keep module instances per file; only setup compilation metadata is shared.
export const loadModule = ({
  codeContent,
  distPath,
  testPath,
  rstestContext,
  assetFiles: assetFilesArg,
  interopDefault,
  virtualFsAssetFiles: virtualFsAssetFilesArg,
  vmContext,
  cacheCompilation = false,
}: {
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: AssetFiles;
  virtualFsAssetFiles?: AssetFiles;
  vmContext?: vm.Context;
  cacheCompilation?: boolean;
}): any => {
  // Fold this file's assets into the persistent map. Recursive loads (require /
  // dynamic imports) re-pass that same map, so skip the no-op self-merge.
  if (assetFilesArg !== accumulatedAssetFiles) {
    Object.assign(accumulatedAssetFiles, assetFilesArg);
  }
  const assetFiles = accumulatedAssetFiles;
  const virtualFsAssetFiles = virtualFsAssetFilesArg ? assetFiles : undefined;
  const fileDir = path.dirname(testPath);

  const localModule = {
    children: [],
    exports: {},
    filename: testPath,
    id: testPath,
    isPreloading: false,
    loaded: false,
    path: fileDir,
  };

  const context = {
    module: localModule,
    exports: localModule.exports,
    require: createRequire(
      testPath,
      distPath,
      rstestContext,
      assetFiles,
      interopDefault,
      virtualFsAssetFiles,
      vmContext,
      cacheCompilation,
    ),
    [RSTEST_DYNAMIC_IMPORT_HOOK]: defineRstestDynamicImport({
      testPath,
      interopDefault,
      vmContext,
    }),
    [RSTEST_REQUIRE_RESOLVE_HOOK]: defineRstestRequireResolve({
      testPath,
      distPath,
      assetFiles,
    }),
    __dirname: fileDir,
    __filename: testPath,
    ...rstestContext,
  };

  const code = `'use strict';return function(){\n${codeContent}\n}`;

  const params = Object.keys(context);
  const cached = cacheCompilation ? compilationCache.get(distPath) : undefined;
  const cachedData =
    cached?.code === code &&
    cached.params.length === params.length &&
    cached.params.every((param, index) => param === params[index])
      ? cached.cachedData
      : undefined;
  const importModuleDynamically = (
    specifier: string,
    _referencer: unknown,
    importAttributes: ImportAttributes,
  ) => {
    return defineRstestDynamicImport({
      testPath,
      interopDefault,
      returnModule: true,
      vmContext,
    })(specifier, importAttributes as ImportCallOptions);
  };
  let fn = vm.compileFunction(code, params, {
    // Used in stack traces produced by this script.
    filename: distPath,
    lineOffset: -1,
    columnOffset: 0,
    ...(vmContext ? { parsingContext: vmContext } : {}),
    ...(cachedData
      ? { cachedData }
      : cacheCompilation
        ? { produceCachedData: true }
        : {}),
    importModuleDynamically,
  });
  if (cachedData && fn.cachedDataRejected) {
    fn = vm.compileFunction(code, params, {
      filename: distPath,
      lineOffset: -1,
      columnOffset: 0,
      ...(vmContext ? { parsingContext: vmContext } : {}),
      produceCachedData: true,
      importModuleDynamically,
    });
  }
  if (cacheCompilation && fn.cachedDataProduced && fn.cachedData) {
    compilationCache.set(distPath, { code, params, cachedData: fn.cachedData });
  }
  fn(...Object.values(context)).call(localModule.exports);

  return localModule.exports;
};

const moduleCache = new Map<string, any>();
const vmModuleCaches = new WeakMap<vm.Context, Map<string, any>>();

const getModuleCache = (vmContext?: vm.Context): Map<string, any> => {
  if (!vmContext) {
    return moduleCache;
  }

  let cache = vmModuleCaches.get(vmContext);
  if (!cache) {
    cache = new Map();
    vmModuleCaches.set(vmContext, cache);
  }
  return cache;
};

// V8 cached data is safe to instantiate in multiple realms; module exports are
// deliberately not stored here, so setup dependencies keep file isolation.
const compilationCache = new Map<
  string,
  { code: string; params: string[]; cachedData: Buffer }
>();

export const cacheableLoadModule = ({
  codeContent,
  distPath,
  testPath,
  rstestContext,
  assetFiles,
  interopDefault,
  virtualFsAssetFiles,
  vmContext,
  cacheCompilation = false,
}: {
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: AssetFiles;
  virtualFsAssetFiles?: AssetFiles;
  vmContext?: vm.Context;
  cacheCompilation?: boolean;
}): any => {
  const cache = getModuleCache(vmContext);
  if (cache.has(testPath)) {
    return cache.get(testPath);
  }
  const mod = loadModule({
    codeContent,
    distPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
    virtualFsAssetFiles,
    vmContext,
    cacheCompilation,
  });
  cache.set(testPath, mod);
  return mod;
};

/**
 * Reset the per-worker module cache between test files.
 *
 * Mirrors the ESM loader: with `isolate: false` the shared runtime chunk owns
 * the only `__webpack_module_cache__`, so keeping it (via `keep`) preserves the
 * module-scope state of every already-evaluated non-entry module across files.
 * A reused worker can serve more than one project, so every project's runtime
 * chunk is accumulated and kept — see `keptRuntimeChunks`.
 * See https://github.com/web-infra-dev/rstest/issues/1373.
 */
export const clearModuleCache = (keep?: string): void => {
  if (keep) {
    keptRuntimeChunks.add(keep);
    for (const key of moduleCache.keys()) {
      if (!keptRuntimeChunks.has(key)) {
        moduleCache.delete(key);
      }
    }
  } else {
    moduleCache.clear();
    keptRuntimeChunks.clear();
    // Nothing is kept, so no hook holds a reference to the accumulated assets.
    for (const key of Object.keys(accumulatedAssetFiles)) {
      delete accumulatedAssetFiles[key];
    }
    clearCacheCleaners();
  }
  clearSyntheticModuleCache();
};

export const clearCompilationCache = (): void => {
  compilationCache.clear();
};
