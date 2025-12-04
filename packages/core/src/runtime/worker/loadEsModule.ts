import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm, { type ModuleLinker, type SourceTextModule } from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { interopModule, shouldInterop } from './interop';

export enum EsmMode {
  Unknown = 0,
  Evaluated = 1,
  Unlinked = 2,
}

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const defineRstestDynamicImport =
  ({
    distPath,
    testPath,
    assetFiles,
    interopDefault,
    returnModule,
    esmMode,
  }: {
    esmMode: EsmMode;
    assetFiles: Record<string, string>;
    returnModule?: boolean;
    distPath: string;
    testPath: string;
    interopDefault: boolean;
  }) =>
  async (specifier: string, importAttributes: ImportCallOptions) => {
    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(specifier)
      ? path.join(currentDirectory, specifier)
      : specifier;

    const content = assetFiles[joinedPath];

    if (content) {
      try {
        return await loadModule({
          codeContent: content,
          testPath,
          distPath: joinedPath,
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

    const resolvedPath = isAbsolute(specifier)
      ? pathToFileURL(specifier)
      : // TODO: use module path instead of testPath
        import.meta.resolve(specifier, pathToFileURL(testPath));

    const modulePath =
      typeof resolvedPath === 'string' ? resolvedPath : resolvedPath.pathname;

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
        ? asModule(importedModule.default)
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
        return asModule(mod);
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

export const asModule = async (
  something: Record<string, any>,
  context?: Record<string, any>,
  unlinked?: boolean,
): Promise<SourceTextModule> => {
  const { Module, SyntheticModule } = await import('node:vm');

  if (something instanceof Module) {
    return something;
  }

  const exports = [...new Set(['default', ...Object.keys(something)])];

  const syntheticModule = new SyntheticModule(
    exports,
    () => {
      for (const name of exports) {
        syntheticModule.setExport(
          name,
          name === 'default' ? (something[name] ?? something) : something[name],
        );
      }
    },
    { context },
  );

  if (unlinked) return syntheticModule;

  await syntheticModule.link((() => {}) as unknown as ModuleLinker);
  await syntheticModule.evaluate();
  return syntheticModule;
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
}: {
  esmMode?: EsmMode;
  interopDefault: boolean;
  codeContent: string;
  distPath: string;
  testPath: string;
  rstestContext: Record<string, any>;
  assetFiles: Record<string, string>;
}): Promise<any> => {
  const code = codeContent;
  let esm = esmCache.get(distPath);
  if (!esm) {
    esm = new vm.SourceTextModule(code, {
      identifier: distPath,
      lineOffset: 0,
      columnOffset: 0,
      initializeImportMeta: (meta) => {
        meta.url = pathToFileURL(testPath).toString();
        // @ts-expect-error
        meta.__rstest_dynamic_import__ = defineRstestDynamicImport({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
          interopDefault,
          returnModule: false,
          esmMode: EsmMode.Unknown,
        });
      },
      importModuleDynamically: (specifier, _referencer, importAttributes) => {
        return defineRstestDynamicImport({
          assetFiles,
          testPath,
          distPath: distPath || testPath,
          interopDefault,
          returnModule: true,
          esmMode: EsmMode.Unlinked,
        })(specifier, importAttributes as ImportCallOptions);
      },
    });
    distPath && esmCache.set(distPath, esm);
  }

  if (esmMode === EsmMode.Unlinked) return esm;

  if (esm.status === 'unlinked') {
    await esm.link(async (specifier, referencingModule) => {
      const result = await defineRstestDynamicImport({
        assetFiles,
        testPath,
        distPath: distPath || testPath,
        interopDefault,
        returnModule: true,
        esmMode: EsmMode.Unlinked,
      })(specifier, referencingModule as ImportCallOptions);

      const linkedModule = await asModule(
        result,
        referencingModule.context,
        true,
      );
      return linkedModule;
    });
  }

  esm.status !== 'evaluated' &&
    esm.status !== 'evaluating' &&
    (await esm.evaluate());

  const ns = esm.namespace as {
    default: unknown;
  };

  return ns.default && ns.default instanceof Promise ? ns.default : ns;
};
