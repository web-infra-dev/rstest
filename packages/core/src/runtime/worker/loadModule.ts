import { createRequire as createNativeRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { clearCacheCleaners, clearSyntheticModuleCache } from './interop';
import {
  finalizeDynamicImport,
  loadWasmFromContent,
  resolveImportSpecifier,
} from './resolveDynamicImport';
import {
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from './runtimeHooks';

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const getAssetContent = (
  assetFiles: Record<string, string>,
  filePath: unknown,
): string | undefined => {
  if (typeof filePath === 'string') {
    return assetFiles[path.normalize(filePath)];
  }
  if (filePath instanceof URL && filePath.protocol === 'file:') {
    return assetFiles[path.normalize(fileURLToPath(filePath))];
  }
  return undefined;
};

const createFsAssetProxy = (
  fsModule: typeof import('node:fs'),
  assetFiles: Record<string, string>,
): typeof import('node:fs') =>
  new Proxy(fsModule, {
    get(target, property, receiver) {
      if (property === 'existsSync') {
        return (filePath: unknown) =>
          getAssetContent(assetFiles, filePath) !== undefined ||
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
          const content = getAssetContent(assetFiles, filePath);

          if (content !== undefined && typeof callback === 'function') {
            queueMicrotask(() => callback(null, content));
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
          const content = getAssetContent(assetFiles, filePath);
          if (content !== undefined) {
            return content;
          }
          return target.readFileSync(
            filePath as Parameters<typeof target.readFileSync>[0],
            options as Parameters<typeof target.readFileSync>[1],
          );
        };
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
    assetFiles: Record<string, string>;
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

    if (assetFiles[normalizedPath]) {
      return normalizedPath;
    }

    return createNativeRequire(resolveBase).resolve(specifier, options);
  };

const createRequire = (
  filename: string,
  distPath: string,
  rstestContext: Record<string, any>,
  assetFiles: Record<string, string>,
  interopDefault: boolean,
): NodeJS.Require => {
  const _require = (() => {
    try {
      // compat with some testPath may not be an available path but the third-party package name
      return createNativeRequire(filename);
    } catch {
      return createNativeRequire(distPath);
    }
  })();

  const require = ((id: string) => {
    if (id === 'fs' || id === 'node:fs') {
      return createFsAssetProxy(_require(id), assetFiles);
    }

    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(id)
      ? path.join(currentDirectory, id)
      : id;

    const content = assetFiles[joinedPath];

    if (content) {
      try {
        return cacheableLoadModule({
          codeContent: content,
          testPath: joinedPath,
          distPath: joinedPath,
          rstestContext,
          assetFiles,
          interopDefault,
        });
      } catch (err) {
        logger.error(
          `load file ${joinedPath} failed:\n`,
          err instanceof Error ? err.message : err,
        );
      }
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
    assetFiles,
  }: {
    returnModule?: boolean;
    testPath: string;
    interopDefault: boolean;
    assetFiles: Record<string, string>;
  }) =>
  async (
    specifier: string,
    importAttributes: ImportCallOptions,
    origin?: string,
  ) => {
    const modulePath = resolveImportSpecifier({ specifier, origin, testPath });

    // Bundled `.wasm` is emitted as an in-memory asset file and must be
    // instantiated from that content — Node's loader cannot import the virtual
    // dist path. Every other specifier resolves and imports natively below.
    if (modulePath.endsWith('.wasm')) {
      const normalizedPath = path.normalize(
        modulePath.startsWith('file://')
          ? fileURLToPath(modulePath)
          : modulePath,
      );
      const content = assetFiles[normalizedPath];

      if (content) {
        return loadWasmFromContent(content, modulePath, returnModule);
      }
    }

    return finalizeDynamicImport({
      modulePath,
      importAttributes,
      interopDefault,
      returnModule,
    });
  };

// Persistent asset map for the kept runtime chunk under `isolate: false` (the
// per-module hooks closed over this reference). Mirrors the ESM loader — see
// `loadEsModule.ts` for the full rationale.
const accumulatedAssetFiles: Record<string, string> = {};

// Every shared runtime chunk this (possibly reused) worker has loaded under
// `isolate: false`. Mirrors the ESM loader — a reused worker can serve multiple
// projects (the pool has no environment affinity), so keeping a single id would
// let one project's teardown evict another's runtime chunk. Accumulate all and
// reset only on a full clear; see `loadEsModule.ts` for the full rationale.
const keptRuntimeChunks = new Set<string>();

// setup and rstest module should not be cached
export const loadModule = ({
  codeContent,
  distPath,
  testPath,
  rstestContext,
  assetFiles: assetFilesArg,
  interopDefault,
}: {
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: Record<string, string>;
}): any => {
  // Fold this file's assets into the persistent map. Recursive loads (require /
  // dynamic imports) re-pass that same map, so skip the no-op self-merge.
  if (assetFilesArg !== accumulatedAssetFiles) {
    Object.assign(accumulatedAssetFiles, assetFilesArg);
  }
  const assetFiles = accumulatedAssetFiles;
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
    ),
    readWasmFile: (
      wasmPath: string,
      callback: (err: Error | null, data?: Buffer) => void,
    ) => {
      const joinedPath = isRelativePath(wasmPath)
        ? path.join(path.dirname(distPath), wasmPath)
        : wasmPath;
      const content = assetFiles[path.normalize(joinedPath)];

      if (content) {
        callback(null, Buffer.from(content, 'base64'));
      } else {
        callback(
          new Error(`WASM file ${joinedPath} not found in asset files.`),
        );
      }
    },
    [RSTEST_DYNAMIC_IMPORT_HOOK]: defineRstestDynamicImport({
      testPath,
      interopDefault,
      assetFiles,
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

  const fn = vm.compileFunction(code, Object.keys(context), {
    // Used in stack traces produced by this script.
    filename: distPath,
    lineOffset: -1,
    columnOffset: 0,
    importModuleDynamically: (specifier, _referencer, importAttributes) => {
      return defineRstestDynamicImport({
        testPath,
        interopDefault,
        returnModule: true,
        assetFiles,
      })(specifier, importAttributes as ImportCallOptions);
    },
  });
  fn(...Object.values(context)).call(localModule.exports);

  return localModule.exports;
};

const moduleCache = new Map<string, any>();

export const cacheableLoadModule = ({
  codeContent,
  distPath,
  testPath,
  rstestContext,
  assetFiles,
  interopDefault,
}: {
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: Record<string, string>;
}): any => {
  if (moduleCache.has(testPath)) {
    return moduleCache.get(testPath);
  }
  const mod = loadModule({
    codeContent,
    distPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
  });
  moduleCache.set(testPath, mod);
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
