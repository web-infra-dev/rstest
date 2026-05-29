import { createRequire as createNativeRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
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

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const resolveModule = (specifier: string, resolveBase: string): string | URL =>
  importMetaResolve(
    specifier,
    resolveBase.startsWith('file:')
      ? resolveBase
      : pathToFileURL(resolveBase).href,
  );

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
  require.resolve = defineRstestRequireResolve({
    testPath: filename,
    distPath,
    assetFiles,
  }) as NodeJS.RequireResolve;
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
    // `origin` is the absolute path of the source module that produced the
    // `import()` call, injected by rspack's `RstestPlugin` when
    // `injectDynamicImportOrigin` is enabled. Falling back to `testPath`
    // keeps the vm `importModuleDynamically` callback (which has no origin
    // to pass) working as before.
    const resolveBase = origin ?? testPath;
    const resolvedPath = isAbsolute(specifier)
      ? pathToFileURL(specifier).href
      : resolveModule(specifier, resolveBase);

    // Use `.href` rather than `.pathname` so Windows absolute specifiers
    // round-trip through Node's ESM loader as valid `file:///D:/...` URLs
    // instead of `/D:/...`, which Node re-resolves as `D:\D:\...`.
    const modulePath =
      typeof resolvedPath === 'string' ? resolvedPath : resolvedPath.href;

    if (modulePath.endsWith('.wasm')) {
      const normalizedPath = path.normalize(
        modulePath.startsWith('file://')
          ? fileURLToPath(modulePath)
          : modulePath,
      );
      const content = assetFiles[normalizedPath];

      if (content) {
        const wasmBuffer = Buffer.from(content, 'base64');
        const wasmModule = await WebAssembly.compile(wasmBuffer);
        const wasmInstance = await WebAssembly.instantiate(wasmModule);
        const exports = wasmInstance.exports as Record<string, any>;
        return returnModule ? asModule(exports, modulePath, exports) : exports;
      }
    }

    // Rstest importAttributes is used internally to distinguish `importActual` and normal imports,
    // and should not be passed to Node.js side, otherwise it will cause ERR_IMPORT_ATTRIBUTE_UNSUPPORTED error.
    if (importAttributes?.with?.rstest) {
      delete importAttributes.with.rstest;
    }

    if (modulePath.endsWith('.json')) {
      // const json = await import(jsonPath);
      // should return { default: jsonExports, ...jsonExports }
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
      })
    ) {
      const { mod, defaultExport } = interopModule(importedModule);

      if (returnModule) {
        return asModule(mod, modulePath, defaultExport);
      }

      return createInteropProxy(mod, defaultExport);
    }
    return importedModule;
  };

// setup and rstest module should not be cached
export const loadModule = ({
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
    __rstest_dynamic_import__: defineRstestDynamicImport({
      testPath,
      interopDefault,
      assetFiles,
    }),
    __rstest_require_resolve__: defineRstestRequireResolve({
      testPath,
      distPath,
      assetFiles,
    }),
    __dirname: fileDir,
    __filename: testPath,
    ...rstestContext,
  };

  const codeDefinition = `'use strict';(${Object.keys(context).join(',')})=>{`;
  const code = `${codeDefinition}${codeContent}\n}`;

  const fn = vm.runInThisContext(code, {
    // Used in stack traces produced by this script.
    filename: distPath,
    lineOffset: 0,
    columnOffset: -codeDefinition.length,
    importModuleDynamically: (specifier, _referencer, importAttributes) => {
      return defineRstestDynamicImport({
        testPath,
        interopDefault,
        returnModule: true,
        assetFiles,
      })(specifier, importAttributes as ImportCallOptions);
    },
  });
  fn(...Object.values(context));

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

export const clearModuleCache = (): void => {
  moduleCache.clear();
  clearSyntheticModuleCache();
};
