import { createRequire as createNativeRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { asModule, interopModule, shouldInterop } from './interop';

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const createRequire = (
  filename: string,
  distPath: string,
  rstestContext: Record<string, any>,
  assetFiles: Record<string, string>,
  interopDefault: boolean,
): NodeJS.Require => {
  const _require = createNativeRequire(filename);
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
      : await import.meta.resolve(specifier, pathToFileURL(testPath));

    const modulePath =
      typeof resolvedPath === 'string' ? resolvedPath : resolvedPath.pathname;

    const importedModule = await import(
      modulePath,
      importAttributes as ImportCallOptions
    );

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

const loadModule = ({
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
    __rstest_dynamic_import__: defineRstestDynamicImport({
      testPath,
      interopDefault,
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
