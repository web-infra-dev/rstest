import fs from 'node:fs';
import { createRequire as createNativeRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { asModule, interopModule, shouldInterop } from './interop';

let latestAssetFiles: Record<string, string> = {};

export const updateLatestAssetFiles = (
  assetFiles: Record<string, string>,
): void => {
  latestAssetFiles = assetFiles;
};

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

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
    } catch (_err) {
      return createNativeRequire(distPath);
    }
  })();

  const require = ((id: string) => {
    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(id)
      ? path.join(currentDirectory, id)
      : id;
    const normalizedJoinedPath = path.normalize(joinedPath);

    // Prefer in-memory assets produced by the bundler (dev server output).
    // For Module Federation / async-node, runtime may `require()` chunks from disk,
    // so fall back to reading from filesystem to keep evaluation inside our VM
    // wrapper (ensures `__rstest_dynamic_import__` and other shims exist).
    const content =
      assetFiles[normalizedJoinedPath] ||
      latestAssetFiles[normalizedJoinedPath] ||
      (isRelativePath(id) && fs.existsSync(normalizedJoinedPath)
        ? fs.readFileSync(normalizedJoinedPath, 'utf8')
        : undefined);

    if (content) {
      try {
        return cacheableLoadModule({
          codeContent: content,
          testPath: normalizedJoinedPath,
          distPath: normalizedJoinedPath,
          rstestContext,
          assetFiles,
          interopDefault,
        });
      } catch (err) {
        logger.error(
          `load file ${normalizedJoinedPath} failed:\n`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const resolved = _require.resolve(id);
    return _require(resolved);
  }) as NodeJS.Require;
  require.resolve = _require.resolve;
  require.main = _require.main;
  return require;
};

const defineRstestDynamicImport =
  ({
    testPath,
    interopDefault,
    returnModule = false,
  }: {
    returnModule?: boolean;
    testPath: string;
    interopDefault: boolean;
  }) =>
  async (specifier: string, importAttributes: ImportCallOptions) => {
    const resolvedPath = isAbsolute(specifier)
      ? pathToFileURL(specifier)
      : import.meta.resolve(specifier, pathToFileURL(testPath));

    const modulePath =
      typeof resolvedPath === 'string' ? resolvedPath : resolvedPath.pathname;

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
        ? asModule(importedModule.default, importedModule.default)
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
        return asModule(mod, defaultExport);
      }

      return new Proxy(mod, {
        get(mod, prop) {
          if (prop === 'default') {
            return defaultExport;
          }
          /**
           * interop invalid named exports. eg:
           * exports: module.exports = { a: 1 }
           * import: import { a } from 'mod';
           */
          return mod[prop] ?? defaultExport?.[prop];
        },
        has(mod, prop) {
          if (prop === 'default') {
            return defaultExport !== undefined;
          }
          return prop in mod || (defaultExport && prop in defaultExport);
        },
        getOwnPropertyDescriptor(mod, prop): any {
          const descriptor = Reflect.getOwnPropertyDescriptor(mod, prop);
          if (descriptor) {
            return descriptor;
          }
          if (prop === 'default' && defaultExport !== undefined) {
            return {
              value: defaultExport,
              enumerable: true,
              configurable: true,
            };
          }
        },
      });
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
      const content =
        assetFiles[path.normalize(joinedPath)] ||
        latestAssetFiles[path.normalize(joinedPath)];

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
    }),
    __dirname: fileDir,
    __filename: testPath,
    ...rstestContext,
  };

  // Some runtimes (notably Module Federation's Node runtime plugin) may evaluate code
  // via `vm`/`eval` wrappers that do not preserve the function-argument injection
  // we do below. Expose the dynamic import shim on globalThis as a fallback so
  // those evaluated chunks can still resolve external modules.
  //
  // This is intentionally best-effort and scoped to the worker process.
  try {
    (globalThis as any).__rstest_dynamic_import__ =
      context.__rstest_dynamic_import__;
  } catch {
    // ignore
  }
  try {
    // Ensure a global binding exists for strict-mode scripts evaluated via vm/eval.
    // Note: assigning on globalThis alone is not enough because evaluated scripts
    // may refer to an unscoped identifier `__rstest_dynamic_import__`.
    vm.runInThisContext(
      'globalThis.__rstest_dynamic_import__ = globalThis.__rstest_dynamic_import__ || undefined; var __rstest_dynamic_import__ = globalThis.__rstest_dynamic_import__',
    );
  } catch {
    // ignore
  }

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
