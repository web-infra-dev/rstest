import { createRequire as createNativeRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm, { type SourceTextModule } from 'node:vm';
import path from 'pathe';
import { logger } from '../../utils/logger';
import { clearSyntheticModuleCache } from './interop';
import {
  finalizeDynamicImport,
  loadWasmFromContent,
  resolveImportSpecifier,
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
          return loadWasmFromContent(content, joinedPath, returnModule);
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

    return finalizeDynamicImport({
      modulePath: resolveImportSpecifier({ specifier, origin, testPath }),
      importAttributes,
      interopDefault,
      returnModule,
    });
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

export const clearModuleCache = (): void => {
  esmCache.clear();
  clearSyntheticModuleCache();
};
