import { builtinModules } from 'node:module';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm, { type SourceTextModule } from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import {
  asModule,
  clearSyntheticModuleCache,
  createInteropProxy,
  interopModule,
  shouldInterop,
} from './interop';

const importMetaResolve = import.meta.resolve;

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

const isBuiltinSpecifier = (specifier: string) =>
  specifier.startsWith('node:') || builtinModules.includes(specifier);

const resolveModule = (specifier: string, resolveBase: string): string | URL =>
  // Node's loader hook worker clones the parent URL when native TypeScript
  // loading is active. Passing URL objects can throw DataCloneError there.
  importMetaResolve(
    specifier,
    resolveBase.startsWith('file:')
      ? resolveBase
      : pathToFileURL(resolveBase).href,
  );

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
    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(specifier)
      ? path.join(currentDirectory, specifier)
      : specifier;
    const normalizedPath = path.normalize(
      joinedPath.startsWith('file://') ? fileURLToPath(joinedPath) : joinedPath,
    );

    const content = assetFiles[normalizedPath];

    if (content) {
      try {
        if (specifier.endsWith('.wasm')) {
          const wasmBuffer = Buffer.from(content, 'base64');
          const wasmModule = await WebAssembly.compile(wasmBuffer);
          const wasmInstance = await WebAssembly.instantiate(wasmModule);
          const exports = wasmInstance.exports as Record<string, any>;
          return returnModule
            ? await asModule(exports, joinedPath, exports)
            : exports;
        }
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

    // `origin` is the absolute path of the source module that produced the
    // `import()` call. It is injected by rspack's `RstestPlugin` when
    // `injectDynamicImportOrigin` is enabled, so relative specifiers in
    // bundled deps resolve against the dep's own directory rather than the
    // test entry's. Fallback to `testPath` keeps the link/vm-callback paths
    // (which have no origin to pass) working as before.
    const resolveBase = origin ?? testPath;
    const resolvedPath = isAbsolute(specifier)
      ? pathToFileURL(specifier).href
      : isBuiltinSpecifier(specifier)
        ? specifier
        : resolveModule(specifier, resolveBase);

    // Use `.href` (full file:// URL) rather than `.pathname` so absolute
    // Windows specifiers (`D:\a\foo.mjs`) remain valid import targets. With
    // `.pathname` the URL object yielded `/D:/a/foo.mjs`, which Node later
    // re-resolved as `D:\D:\a\foo.mjs` (double drive letter).
    const modulePath =
      typeof resolvedPath === 'string' ? resolvedPath : resolvedPath.href;

    // Rstest importAttributes is used internally to distinguish `importActual` and normal imports,
    // and should not be passed to Node.js side, otherwise it will cause ERR_IMPORT_ATTRIBUTE_UNSUPPORTED error.
    if (importAttributes?.with?.rstest) {
      delete importAttributes.with.rstest;
    }

    if (modulePath.endsWith('.json')) {
      const importedModule = await import(modulePath, {
        with: { type: 'json' },
      });

      return returnModule
        ? asModule(importedModule.default, modulePath, importedModule.default)
        : {
            ...importedModule.default,
            default: importedModule.default,
          };
    }
    const importedModule = await import(modulePath, importAttributes);

    if (
      shouldInterop({
        interopDefault,
        modulePath,
        mod: importedModule,
      }) &&
      !modulePath.startsWith('node:')
    ) {
      const { mod, defaultExport } = interopModule(importedModule);
      if (returnModule) {
        return asModule(mod, modulePath, defaultExport);
      }

      return createInteropProxy(mod, defaultExport);
    }

    if (returnModule) {
      return asModule(importedModule, modulePath, importedModule.default);
    }
    return importedModule;
  };

const esmCache = new Map<string, SourceTextModule>();

// setup and rstest module should not be cached
export const loadModule = async ({
  codeContent,
  distPath,
  testPath,
  assetFiles,
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
        meta.__rstest_dynamic_import__ = defineRstestDynamicImport({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
          runtimeDistPath,
          interopDefault,
          returnModule: false,
          esmMode: EsmMode.Unknown,
        });
        // @ts-expect-error
        meta.readWasmFile = (
          wasmPath: URL,
          callback: (err: Error | null, data?: Buffer) => void,
        ) => {
          const joinedPath = isRelativePath(wasmPath.pathname)
            ? path.join(path.dirname(distPath), wasmPath.pathname)
            : wasmPath.pathname;

          const content = assetFiles[path.normalize(joinedPath)];

          if (content) {
            callback(null, Buffer.from(content, 'base64'));
          } else {
            callback(
              new Error(`WASM file ${joinedPath} not found in asset files.`),
            );
          }
        };
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
      })(specifier, {}, referencingModule.identifier),
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

export const clearModuleCache = (): void => {
  esmCache.clear();
  clearSyntheticModuleCache();
};
