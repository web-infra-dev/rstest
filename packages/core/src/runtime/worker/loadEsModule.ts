import { existsSync } from 'node:fs';
import { createRequire as createNativeRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm, { type SourceTextModule } from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { clearCacheCleaners, clearSyntheticModuleCache } from './interop';
import {
  finalizeDynamicImport,
  loadWasm,
  resolveImportSpecifier,
  maybeResolveMockedDynamicImport,
} from './resolveDynamicImport';
import {
  RSTEST_DYNAMIC_IMPORT_HOOK,
  RSTEST_REQUIRE_RESOLVE_HOOK,
} from './runtimeHooks';

export enum EsmMode {
  Unknown = 0,
  Evaluated = 1,
  Unlinked = 2,
}

const sourceUrlCommentRE = /\/\/[#@]\s*sourceURL=/;
export const shouldInjectSourceURL = (): boolean => {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined;
};

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

export const appendSourceURL = (
  codeContent: string,
  sourceUrl: string,
): string => {
  if (sourceUrlCommentRE.test(codeContent)) {
    return codeContent;
  }

  // Bun's vm.SourceTextModule reports stack frames and source-map-support
  // lookups as synthetic "[source:n]" ids instead of the module identifier.
  // Appending sourceURL keeps the emitted source name stable so sourcemaps
  // still resolve back to the built asset path.
  const suffix = `//# sourceURL=${sourceUrl}`;
  return codeContent.endsWith('\n')
    ? `${codeContent}${suffix}`
    : `${codeContent}\n${suffix}`;
};

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
    const origin =
      typeof optionsOrOrigin === 'string' ? optionsOrOrigin : maybeOrigin;
    const resolveBase = origin ?? testPath;

    const currentDirectory = path.dirname(origin ?? distPath);
    const joinedPath = isRelativePath(specifier)
      ? path.join(currentDirectory, specifier)
      : specifier;
    const normalizedPath = path.normalize(
      joinedPath.startsWith('file://') ? fileURLToPath(joinedPath) : joinedPath,
    );

    if (assetFiles[normalizedPath]) {
      return normalizedPath;
    }

    return createNativeRequire(resolveBase).resolve(specifier, options);
  };

const defineRstestDynamicImport =
  ({
    distPath,
    testPath,
    assetFiles,
    interopDefault,
    returnModule,
    esmMode,
    runtimeDistPath,
  }: {
    esmMode: EsmMode;
    assetFiles: Record<string, string>;
    returnModule?: boolean;
    distPath: string;
    runtimeDistPath?: string;
    testPath: string;
    interopDefault: boolean;
  }) =>
  async (
    specifier: string,
    importAttributes: ImportCallOptions,
    origin?: string,
  ) => {
    // #1454: route `import(variable)` of a mocked module to the bundle's mock
    // instance before any native load (policy in resolveDynamicImport.ts).
    const mocked = maybeResolveMockedDynamicImport(
      specifier,
      returnModule,
      importAttributes,
      origin ?? testPath,
    );
    if (mocked !== undefined) {
      return mocked;
    }

    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(specifier)
      ? path.join(currentDirectory, specifier)
      : specifier;
    const normalizedPath = path.normalize(
      joinedPath.startsWith('file://') ? fileURLToPath(joinedPath) : joinedPath,
    );

    const content = assetFiles[normalizedPath];

    // `.wasm` always resolves to an on-disk source file (wasmLoader.mjs rewrites
    // direct imports; `new URL(...)` resolves source-relative, #1455). Resolve
    // against the source origin — like the CJS loader and the dynamic
    // fall-through below — so a non-literal relative `.wasm` import from a
    // bundled module finds the source file and instantiates via `loadWasm`
    // instead of falling back to a native `.wasm` import (which throws
    // ERR_UNKNOWN_FILE_EXTENSION on Node without `--experimental-wasm-modules`).
    // rstest instantiates it itself so the pattern is flag-free on every Node
    // version.
    if (specifier.endsWith('.wasm')) {
      const wasmPath = resolveImportSpecifier({ specifier, origin, testPath });
      const wasmFsPath = path.normalize(
        wasmPath.startsWith('file://') ? fileURLToPath(wasmPath) : wasmPath,
      );
      if (existsSync(wasmFsPath)) {
        return loadWasm(wasmFsPath, returnModule);
      }
    }

    if (content) {
      try {
        return await loadModule({
          codeContent: content,
          testPath,
          distPath: joinedPath,
          runtimeDistPath,
          rstestContext: {},
          assetFiles,
          interopDefault,
          esmMode,
        });
      } catch (err) {
        logger.error(
          `load file ${joinedPath} failed:\n`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return finalizeDynamicImport({
      modulePath: resolveImportSpecifier({ specifier, origin, testPath }),
      importAttributes,
      interopDefault,
      returnModule,
    });
  };

const esmCache = new Map<string, SourceTextModule>();

// With `isolate: false` the kept runtime chunk's `import.meta` hooks (wasm /
// dynamic-import resolution) capture this asset map BY REFERENCE at creation
// time. Folding every file's assets into one persistent map — the same
// reference those hooks closed over — keeps a later file's chunks resolvable.
// Paths are globally unique per build, so merging never collides; the map is
// reset only on a full `clearModuleCache`.
// See https://github.com/web-infra-dev/rstest/issues/1373.
const accumulatedAssetFiles: Record<string, string> = {};

// Every shared runtime chunk this (possibly reused) worker has loaded under
// `isolate: false`. The pool has no environment affinity — with multiple node
// projects dispatched concurrently a reused worker can run project A, then B,
// then A again — so a single kept id would let B's teardown evict A's runtime
// chunk and re-instantiate A's `__webpack_module_cache__` on its next file,
// losing the cross-file module state we set out to share. Accumulate every
// runtime chunk and keep all of them; reset only on a full clear.
const keptRuntimeChunks = new Set<string>();

// setup and rstest module should not be cached
export const loadModule = async ({
  codeContent,
  distPath,
  testPath,
  assetFiles: assetFilesArg,
  interopDefault,
  esmMode = EsmMode.Unknown,
  runtimeDistPath,
}: {
  esmMode?: EsmMode;
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  runtimeDistPath?: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: Record<string, string>;
}): Promise<any> => {
  // Fold this file's assets into the persistent map. Recursive loads (dynamic
  // imports) re-pass that same map, so skip the no-op self-merge.
  if (assetFilesArg !== accumulatedAssetFiles) {
    Object.assign(accumulatedAssetFiles, assetFilesArg);
  }
  const assetFiles = accumulatedAssetFiles;
  const code = shouldInjectSourceURL()
    ? appendSourceURL(codeContent, distPath)
    : codeContent;
  let esm = esmCache.get(distPath);
  if (!esm) {
    esm = new vm.SourceTextModule(code, {
      identifier: distPath,
      lineOffset: 0,
      columnOffset: 0,
      initializeImportMeta: (meta) => {
        meta.url = pathToFileURL(
          distPath === runtimeDistPath ? distPath : testPath,
        ).toString();
        // @ts-expect-error
        meta[RSTEST_DYNAMIC_IMPORT_HOOK] = defineRstestDynamicImport({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
          runtimeDistPath,
          interopDefault,
          returnModule: false,
          esmMode: EsmMode.Unknown,
        });
        // @ts-expect-error
        meta[RSTEST_REQUIRE_RESOLVE_HOOK] = defineRstestRequireResolve({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
        });
      },
      importModuleDynamically: (specifier, _referencer, importAttributes) => {
        return defineRstestDynamicImport({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
          runtimeDistPath,
          interopDefault,
          returnModule: true,
          esmMode: EsmMode.Unlinked,
        })(specifier, importAttributes as ImportCallOptions);
      },
    });
    if (distPath) esmCache.set(distPath, esm);
  }

  if (esmMode === EsmMode.Unlinked) return esm;

  if (esm.status === 'unlinked') {
    await esm.link((specifier, referencingModule) =>
      defineRstestDynamicImport({
        assetFiles,
        testPath,
        distPath: distPath || testPath,
        runtimeDistPath,
        interopDefault,
        returnModule: true,
        esmMode: EsmMode.Unlinked,
      })(
        specifier,
        {},
        isRelativePath(specifier) ? referencingModule.identifier : undefined,
      ),
    );
  }

  if (esm.status !== 'evaluated' && esm.status !== 'evaluating') {
    await esm.evaluate();
  }

  const ns = esm.namespace as {
    default: unknown;
  };

  return ns.default && ns.default instanceof Promise ? ns.default : ns;
};

/**
 * Reset the per-worker module cache between test files.
 *
 * Under `isolate: false`, `keep` is the shared runtime chunk id that owns the
 * only `__webpack_module_cache__`; preserving it keeps the module-scope state
 * of every already-evaluated non-entry module across files (evaluated once per
 * worker, not per file). Test-entry and setup modules are still evicted so
 * their bodies re-run per file. A reused worker can serve more than one project
 * (the pool has no environment affinity), so every project's runtime chunk is
 * accumulated and kept — see `keptRuntimeChunks`.
 * See https://github.com/web-infra-dev/rstest/issues/1373.
 */
export const clearModuleCache = (keep?: string): void => {
  if (keep) {
    keptRuntimeChunks.add(keep);
    for (const key of esmCache.keys()) {
      if (!keptRuntimeChunks.has(key)) {
        esmCache.delete(key);
      }
    }
  } else {
    esmCache.clear();
    keptRuntimeChunks.clear();
    // Nothing is kept, so no hook holds a reference to the accumulated assets.
    for (const key of Object.keys(accumulatedAssetFiles)) {
      delete accumulatedAssetFiles[key];
    }
    clearCacheCleaners();
  }
  clearSyntheticModuleCache();
};
