import { readFileSync } from 'node:fs';
import {
  initSync as initializeCommonJsLexer,
  parse as parseCommonJsExports,
} from 'cjs-module-lexer';
import {
  createRequire as createNativeRequire,
  isBuiltin,
  Module,
} from 'node:module';
import { dirname as nativeDirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { extname } from 'pathe';
import {
  asModule,
  getOrCreateSyntheticModule,
  interopModule,
} from '../interop';
import {
  createVmTimersLoader,
  createVmTimersPromisesLoader,
  VM_PROMISE_TIMER_EXPORTS,
  VM_TIMER_EXPORTS,
} from './timers';
import {
  clearExternalModuleCache,
  getCommonJsCompilationCache,
  getEsmCompilationCache,
  getExternalFilePath as getFilePath,
  getExternalModuleFormat as getModuleFormat,
  isAmbiguousJavaScriptModule,
  parseExternalDataUri as parseDataUri,
  readExternalSource as readSource,
  resolveExternalSpecifier,
  setCommonJsCompilationCache,
  setEsmCompilationCache,
  stripJsonBom,
} from './externalModuleCache';
type EsmLinkOperation = {
  promise: Promise<vm.Module>;
  reject: (reason?: unknown) => void;
  resolve: (value: vm.Module | PromiseLike<vm.Module>) => void;
};

type SyncSourceTextModule = vm.SourceTextModule & {
  hasAsyncGraph: () => boolean;
  hasTopLevelAwait: () => boolean;
  instantiate: () => void;
  linkRequests: (modules: readonly vm.Module[]) => void;
  readonly moduleRequests: readonly {
    specifier: string;
    attributes?: Record<string, string | undefined>;
  }[];
};

type SyncModuleEntry =
  | {
      commit: false;
      dependencies?: undefined;
      module: vm.Module;
    }
  | {
      commit: true;
      dependencies: string[];
      module: SyncSourceTextModule;
    };

const createEsmLinkOperation = (): EsmLinkOperation => {
  let rejectOperation: EsmLinkOperation['reject'];
  let resolveOperation: EsmLinkOperation['resolve'];
  const promise = new Promise<vm.Module>((resolve, reject) => {
    rejectOperation = reject;
    resolveOperation = resolve;
  });
  return {
    promise,
    reject: rejectOperation!,
    resolve: resolveOperation!,
  };
};

type CommonJsModule = Module & {
  exports: unknown;
};

type CommonJsExportMetadata = {
  code: string;
  names: string[];
  reexports: string[];
};

type BuiltinModuleRecord = {
  module: vm.SyntheticModule;
  imported: Record<string, unknown>;
  overrides: Set<string>;
  wrapExports: boolean;
};

type WebAssemblyCacheEntry = {
  module: Promise<vm.SyntheticModule>;
  loading: Promise<vm.SyntheticModule>;
};

// `hasAsyncGraph` ships with the complete synchronous graph API that Node
// itself uses for require(esm): moduleRequests, linkRequests and instantiate.
const supportsSyncEsmEvaluate =
  typeof vm.SourceTextModule !== 'undefined' &&
  typeof Reflect.get(vm.SourceTextModule.prototype, 'hasAsyncGraph') ===
    'function';

const [nodeMajor = 0] = process.versions.node.split('.').map(Number);
const supportsCjsModuleExportsMarker = nodeMajor >= 23;

initializeCommonJsLexer();

// Selecting `module-sync` without the VM graph API can resolve a package to an
// ESM-only entry that this loader cannot execute synchronously.
const requireConditions = (() => {
  const conditions = ['node', 'require', 'node-addons'];
  if (supportsSyncEsmEvaluate) {
    conditions.push('module-sync');
  }
  const args = [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS?.split(/\s+/) ?? []),
  ];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    const inlineCondition = argument.match(/^(?:--conditions|-C)=(.+)$/)?.[1];
    if (inlineCondition) {
      conditions.push(inlineCondition);
    } else if (
      (argument === '--conditions' || argument === '-C') &&
      index + 1 < args.length
    ) {
      const condition = args[++index];
      if (condition !== undefined) {
        conditions.push(condition);
      }
    }
  }
  if (!supportsSyncEsmEvaluate) {
    return new Set(
      conditions.filter((condition) => condition !== 'module-sync'),
    );
  }
  return new Set(conditions);
})();

type RequireResolveWithConditions = (
  specifier: string,
  options?: { conditions?: Set<string>; paths?: string[] },
) => string;

const resolveRequire = (
  nativeRequire: NodeJS.Require,
  specifier: string,
  options?: { paths?: string[] },
): string =>
  (nativeRequire.resolve as RequireResolveWithConditions)(specifier, {
    ...options,
    conditions: requireConditions,
  });

let executors = new WeakMap<vm.Context, VmExternalModules>();
let scriptExecutors = new WeakMap<vm.Script, VmExternalModules>();

type CommonJsScript = vm.Script & { identifier: string };

const staticCommonJsImportModuleDynamically: vm.DynamicModuleLoader<
  vm.Script
> = (specifier, referencer, importAttributes) => {
  const executor = scriptExecutors.get(referencer);
  if (!executor) {
    throw new Error(
      `Cannot import "${specifier}": the test context was torn down.`,
    );
  }
  const identifier = Reflect.get(referencer, 'identifier');
  if (typeof identifier !== 'string') {
    throw new Error(
      `Cannot import "${specifier}": the CommonJS referrer has no identifier.`,
    );
  }
  return executor.importModuleDynamically(
    specifier,
    identifier,
    importAttributes as unknown as ExternalImportAttributes,
  );
};

const getContextExecutor = (module: vm.SourceTextModule): VmExternalModules => {
  const executor = executors.get(module.context);
  if (!executor) {
    throw new Error(
      `Cannot import "${module.identifier}": its vm context was torn down.`,
    );
  }
  return executor;
};

const staticImportModuleDynamically: vm.DynamicModuleLoader<
  vm.SourceTextModule
> = (specifier, referencer, importAttributes) =>
  getContextExecutor(referencer).importModuleDynamically(
    specifier,
    referencer.identifier,
    importAttributes as unknown as ExternalImportAttributes,
  );

const staticInitializeImportMeta = (
  meta: ImportMeta,
  module: vm.SourceTextModule,
): void => {
  const { identifier } = module;
  meta.url = identifier;
  if (Object.hasOwn(import.meta, 'main')) {
    Object.defineProperty(meta, 'main', {
      configurable: true,
      enumerable: true,
      value: false,
    });
  }
  if (identifier.startsWith('file:')) {
    const filePath = getFilePath(identifier);
    meta.filename = filePath;
    meta.dirname = nativeDirname(filePath);
  }
  meta.resolve = (specifier: string, parent?: string | URL) =>
    getContextExecutor(module).resolve(
      specifier,
      parent === undefined ? identifier : parent.toString(),
    );
};

const stripCommonJsPrefix = (source: string): string =>
  source.replace(/^\uFEFF/, '').replace(/^#!.*(?:\r?\n|$)/, '');

const getNodeModulePaths = (filePath: string): string[] =>
  createNativeRequire(filePath).resolve.paths('__rstest_module_lookup__') ?? [];

const createVmError = (
  context: vm.Context,
  message: string,
  code: string,
): NodeJS.ErrnoException => {
  const ErrorConstructor = vm.runInContext('Error', context) as new (
    message?: string,
  ) => Error;
  const error = new ErrorConstructor(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const createRequireEsmError = (
  context: vm.Context,
  filePath: string,
): NodeJS.ErrnoException => {
  return createVmError(
    context,
    `require() of ES Module ${filePath} is not supported in the vmThreads pool. Use dynamic import() instead.`,
    'ERR_REQUIRE_ESM',
  );
};

const createRequireAsyncModuleError = (
  context: vm.Context,
  identifier: string,
  detail: string,
): NodeJS.ErrnoException => {
  return createVmError(
    context,
    `require() cannot be used to load ES Module ${identifier}: ${detail}. Use import() instead.`,
    'ERR_REQUIRE_ASYNC_MODULE',
  );
};

const createConcurrentRequireError = (
  context: vm.Context,
  identifier: string,
): NodeJS.ErrnoException => {
  return createVmError(
    context,
    `Cannot require() ES Module ${identifier} synchronously because it is currently being loaded by import().`,
    'ERR_REQUIRE_ESM',
  );
};

const createRequireCycleError = (
  context: vm.Context,
  identifier: string,
): NodeJS.ErrnoException => {
  return createVmError(
    context,
    `Cannot require() ES Module ${identifier} in a cycle. A cycle involving require(esm) is not allowed.`,
    'ERR_REQUIRE_CYCLE_MODULE',
  );
};

const isSyntaxError = (error: unknown): boolean =>
  error instanceof SyntaxError ||
  (typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'name') === 'SyntaxError');

type ExternalImportAttributes = Record<string, string | undefined> | undefined;

const getImportAttributes = (
  importAttributes:
    ExternalImportAttributes | { with?: ExternalImportAttributes },
): Record<string, string> => {
  if (!importAttributes) {
    return {};
  }
  const withAttributes = Reflect.get(importAttributes, 'with');
  if (withAttributes && typeof withAttributes === 'object') {
    return withAttributes as Record<string, string>;
  }
  return importAttributes as Record<string, string>;
};

const createImportAttributeError = (
  context: vm.Context,
  code:
    | 'ERR_IMPORT_ATTRIBUTE_MISSING'
    | 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE'
    | 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  message: string,
): NodeJS.ErrnoException => {
  return createVmError(context, message, code);
};

const moduleHasAsyncGraph = (module: vm.Module): boolean =>
  module instanceof vm.SourceTextModule &&
  (module as SyncSourceTextModule).hasAsyncGraph();

const createUnsupportedFormatError = (
  filePath: string,
): NodeJS.ErrnoException => {
  const extension = extname(filePath) || '(no extension)';
  const error: NodeJS.ErrnoException = new Error(
    `External module ${filePath} has unsupported format ${extension} in the vmThreads pool. Bundle this module instead of externalizing it.`,
  );
  error.code = 'ERR_UNKNOWN_FILE_EXTENSION';
  return error;
};

class VmExternalModules {
  private readonly commonJsCache = new Map<string, CommonJsModule>();
  private readonly esmCache = new Map<string, SyncSourceTextModule>();
  private readonly esmRequireNamespaceCache = new Map<
    string,
    Record<PropertyKey, unknown>
  >();
  private readonly esmJsonCache = new Map<string, unknown>();
  private readonly moduleEvaluationCache = new Map<string, Promise<void>>();
  private readonly esmLinkOperations = new Map<string, EsmLinkOperation>();
  private readonly esmSyntaxFallbackFiles = new Set<string>();
  private readonly jsonCache = new Map<string, CommonJsModule>();
  private readonly loadVmTimers: ReturnType<typeof createVmTimersLoader>;
  private readonly loadVmTimersPromises: ReturnType<
    typeof createVmTimersPromisesLoader
  >;
  private readonly parseJson: (source: string) => unknown;
  private readonly requireCache: NodeJS.Require['cache'];
  private readonly scripts = new Set<vm.Script>();
  private readonly webAssemblyCache = new Map<string, WebAssemblyCacheEntry>();
  private readonly commonJsExportNames = new Map<
    string,
    CommonJsExportMetadata
  >();
  private readonly builtinModuleRecords = new Map<
    string,
    BuiltinModuleRecord
  >();
  private linkQueue: Promise<void> = Promise.resolve();
  private moduleBuiltin: unknown;
  private moduleClass: typeof Module | undefined;
  private processBuiltin: unknown;
  private interopDefault = true;
  private readonly activeSyncRequireRoots = new Set<string>();
  private readonly vmError: typeof Error;
  private readonly getVmErrorConstructor: (name: string) => typeof Error;
  private readonly vmPromise: PromiseConstructor;
  private readonly isVmError: (value: unknown) => boolean;
  private readonly isVmValue: (value: unknown) => boolean;
  private readonly wrappedBuiltinValues = new WeakMap<object, unknown>();
  private readonly unwrappedBuiltinValues = new WeakMap<object, object>();

  constructor(private readonly context: vm.Context) {
    this.vmError = vm.runInContext('Error', context) as typeof Error;
    this.getVmErrorConstructor = vm.runInContext(
      `(name) => {
        const constructor = globalThis[name];
        return typeof constructor === 'function' &&
          (constructor === Error || constructor.prototype instanceof Error)
          ? constructor
          : Error;
      }`,
      context,
    ) as (name: string) => typeof Error;
    this.vmPromise = vm.runInContext('Promise', context) as PromiseConstructor;
    this.isVmError = vm.runInContext(
      '(value) => value instanceof Error',
      context,
    ) as (value: unknown) => boolean;
    this.isVmValue = vm.runInContext(
      `(value) => {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          return false;
        }
        if (typeof value === 'function') {
          return value instanceof Function;
        }
        const prototype = Object.getPrototypeOf(value);
        return prototype === null ||
          prototype === Object.prototype ||
          prototype === Array.prototype;
      }`,
      context,
    ) as (value: unknown) => boolean;
    this.loadVmTimers = createVmTimersLoader(
      vm.runInContext('globalThis', context) as Record<PropertyKey, unknown>,
    );
    this.loadVmTimersPromises = createVmTimersPromisesLoader(
      vm.runInContext('globalThis', context) as Record<PropertyKey, unknown>,
    );
    this.parseJson = vm.runInContext('JSON.parse', context) as (
      source: string,
    ) => unknown;
    const cacheTarget = vm.runInContext(
      'Object.create(null)',
      context,
    ) as NodeJS.Require['cache'];
    this.requireCache = new Proxy(cacheTarget, {
      deleteProperty: (target, property) => {
        if (typeof property === 'string') {
          this.commonJsCache.delete(property);
          this.jsonCache.delete(property);
        }
        return Reflect.deleteProperty(target, property);
      },
    });
  }

  createRequire = (
    filename: string | URL,
    getParentModule?: () => CommonJsModule,
  ): NodeJS.Require => {
    const nativeRequire = createNativeRequire(filename);
    const require = ((specifier: string) =>
      this.require(specifier, filename, getParentModule?.())) as NodeJS.Require;

    require.resolve = Object.assign(
      (specifier: string, options?: { paths?: string[] }) => {
        try {
          return resolveRequire(nativeRequire, specifier, options);
        } catch (error) {
          throw this.wrapBuiltinError(error);
        }
      },
      {
        paths: nativeRequire.resolve.paths.bind(nativeRequire.resolve),
      },
    );
    require.main = nativeRequire.main;
    require.cache = this.requireCache;
    require.extensions = nativeRequire.extensions;
    return require;
  };

  require(
    specifier: string,
    parent: string | URL,
    parentModule?: CommonJsModule,
  ): unknown {
    if (isBuiltin(specifier)) {
      return this.loadBuiltin(specifier);
    }

    const nativeRequire = createNativeRequire(parent);
    let resolved: string;
    try {
      resolved = resolveRequire(nativeRequire, specifier);
    } catch (error) {
      throw this.wrapBuiltinError(error);
    }
    switch (getModuleFormat(resolved, 'require')) {
      case 'data':
        throw createRequireEsmError(this.context, resolved);
      case 'commonjs':
        return this.loadCommonJs(resolved, parentModule);
      case 'json':
        return this.loadJson(resolved, parentModule);
      case 'module':
        if (!supportsSyncEsmEvaluate) {
          throw createRequireEsmError(this.context, resolved);
        }
        return this.requireEsm(resolved);
      case 'native':
        return nativeRequire(resolved);
      case 'wasm':
        throw createRequireAsyncModuleError(
          this.context,
          resolved,
          'WebAssembly modules cannot be loaded synchronously',
        );
      case 'unsupported':
        throw createUnsupportedFormatError(resolved);
    }
  }

  async import(
    resolvedId: string,
    interopDefault: boolean,
    returnModule: boolean,
    importAttributes?: ExternalImportAttributes,
  ): Promise<unknown> {
    this.interopDefault = interopDefault;
    const module = await this.enqueueLinkedModule(
      resolvedId,
      interopDefault,
      importAttributes,
    );
    if (returnModule) {
      return module;
    }
    if (module.status !== 'evaluated') {
      await this.evaluateModule(module);
    }
    return module.namespace;
  }

  private enqueueLinkedModule(
    resolvedId: string,
    interopDefault: boolean,
    importAttributes?: ExternalImportAttributes,
  ): Promise<vm.Module> {
    // Node may invoke sibling linker callbacks concurrently. Linking external
    // roots in parallel can split one cyclic graph into operations that wait on
    // each other. Queue linking only; evaluation remains concurrent and may
    // itself perform dynamic imports without deadlocking this queue.
    const linkedModule = this.linkQueue.then(async () => {
      this.validateImportAttributes(resolvedId, importAttributes);
      const module = await this.getModule(resolvedId, interopDefault);
      await this.linkModule(module, interopDefault);
      return module;
    });
    this.linkQueue = linkedModule.then(
      () => undefined,
      () => undefined,
    );
    return linkedModule;
  }

  resolve(specifier: string, parent: string): string {
    return resolveExternalSpecifier(specifier, parent);
  }

  async importModuleDynamically(
    specifier: string,
    parent: string,
    importAttributes?: ExternalImportAttributes,
  ): Promise<vm.Module> {
    const imported = await this.enqueueLinkedModule(
      this.resolve(specifier, parent),
      this.interopDefault,
      importAttributes,
    );
    if (imported.status !== 'evaluated') {
      await this.evaluateModule(imported);
    }
    return imported;
  }

  dispose(): void {
    this.loadVmTimersPromises.dispose();
    this.esmJsonCache.clear();
    this.moduleEvaluationCache.clear();
    for (const script of this.scripts) {
      scriptExecutors.delete(script);
    }
    this.scripts.clear();
  }

  private evaluateModule(module: vm.Module): Promise<void> {
    if (module.status === 'evaluated') {
      return Promise.resolve();
    }
    const cached = this.moduleEvaluationCache.get(module.identifier);
    if (cached) {
      return cached;
    }
    const evaluation = module.evaluate();
    this.moduleEvaluationCache.set(module.identifier, evaluation);
    return evaluation;
  }

  private async getModule(
    resolvedId: string,
    interopDefault: boolean,
    loadingWebAssemblyIds?: ReadonlySet<string>,
  ): Promise<vm.Module> {
    const format = getModuleFormat(resolvedId);
    switch (format) {
      case 'data':
        return this.loadDataModule(resolvedId, loadingWebAssemblyIds);
      case 'module':
        return this.loadEsm(resolvedId);
      case 'commonjs': {
        const filePath = getFilePath(resolvedId);
        const exports = this.loadCommonJs(filePath, undefined, () =>
          this.loadEsm(resolvedId),
        );
        if (exports instanceof Promise) {
          return exports;
        }
        return this.getCommonJsSyntheticModule(
          resolvedId,
          exports,
          interopDefault,
          this.getCommonJsExportNames(filePath),
        );
      }
      case 'json':
        return this.getJsonModule(resolvedId);
      case 'native':
        if (
          !isBuiltin(resolvedId.replace(/^node:/, '')) &&
          extname(getFilePath(resolvedId)) === '.node'
        ) {
          throw createUnsupportedFormatError(getFilePath(resolvedId));
        }
        return this.loadNativeModule(resolvedId);
      case 'wasm':
        return this.loadWebAssemblyModule(
          resolvedId,
          readFileSync(getFilePath(resolvedId)),
          loadingWebAssemblyIds,
        );
      case 'unsupported':
        throw createUnsupportedFormatError(getFilePath(resolvedId));
    }
  }

  private validateImportAttributes(
    resolvedId: string,
    importAttributes?: ExternalImportAttributes,
  ): void {
    const attributes = getImportAttributes(importAttributes);
    const attributeNames = Object.keys(attributes);
    const moduleFormat = getModuleFormat(resolvedId);
    const format =
      moduleFormat === 'data'
        ? (() => {
            const { mime } = parseDataUri(resolvedId);
            return mime === 'application/json'
              ? 'json'
              : mime === 'application/wasm'
                ? 'wasm'
                : 'module';
          })()
        : moduleFormat;
    const type = attributes.type;

    if (format === 'json') {
      if (type === undefined) {
        throw createImportAttributeError(
          this.context,
          'ERR_IMPORT_ATTRIBUTE_MISSING',
          `Module "${resolvedId}" needs an import attribute of "type: json"`,
        );
      }
      if (type !== 'json') {
        throw createImportAttributeError(
          this.context,
          'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
          `Import attribute "type" with value "${type}" is not supported in ${resolvedId}`,
        );
      }
      const unsupported = attributeNames.find((name) => name !== 'type');
      if (unsupported) {
        throw createImportAttributeError(
          this.context,
          'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
          `Import attribute "${unsupported}" with value "${attributes[unsupported]}" is not supported in ${resolvedId}`,
        );
      }
      return;
    }

    if (type === 'json') {
      throw createImportAttributeError(
        this.context,
        'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE',
        'Module "' + resolvedId + '" is not of type "json"',
      );
    }

    if (attributeNames.length > 0) {
      const unsupported = attributeNames[0]!;
      throw createImportAttributeError(
        this.context,
        'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
        `Import attribute "${unsupported}" with value "${attributes[unsupported]}" is not supported in ${resolvedId}`,
      );
    }
  }

  private getCommonJsSyntheticModule(
    resolvedId: string,
    exports: unknown,
    interopDefault = this.interopDefault,
    namedExports?: readonly string[],
  ): vm.SyntheticModule {
    const exportNames =
      namedExports ??
      (exports !== null &&
      (typeof exports === 'object' || typeof exports === 'function')
        ? Object.getOwnPropertyNames(exports)
        : []);
    const namespace: Record<string, any> =
      exports !== null &&
      (typeof exports === 'object' || typeof exports === 'function')
        ? Object.defineProperties(
            {},
            Object.fromEntries(
              exportNames
                .filter((name) => name !== 'default')
                .map((name) => [
                  name,
                  Object.getOwnPropertyDescriptor(exports, name) ?? {
                    configurable: true,
                    enumerable: true,
                    value: undefined,
                    writable: true,
                  },
                ]),
            ),
          )
        : { default: exports };
    if (
      exports !== null &&
      (typeof exports === 'object' || typeof exports === 'function')
    ) {
      Object.defineProperty(namespace, 'default', {
        configurable: true,
        enumerable: true,
        value: exports,
        writable: true,
      });
    }
    const { mod, defaultExport } = interopDefault
      ? interopModule(namespace)
      : { mod: namespace, defaultExport: namespace.default };
    return getOrCreateSyntheticModule(
      mod,
      resolvedId,
      defaultExport,
      this.context,
      // Node 23 added the `module.exports` namespace marker. This is
      // independent of the VM graph API, which is also available in Node 20.
      supportsCjsModuleExportsMarker ? { value: exports } : undefined,
    );
  }

  private getCommonJsExportNames(filePath: string): string[] {
    return this.getCommonJsExportNamesFrom(filePath, new Set());
  }

  private getCommonJsExportNamesFrom(
    filePath: string,
    visited: Set<string>,
  ): string[] {
    if (visited.has(filePath)) {
      return [];
    }
    visited.add(filePath);

    const source = readSource(filePath);
    const cached = this.commonJsExportNames.get(filePath);
    const metadata =
      cached?.code === source
        ? cached
        : (() => {
            const { exports: names, reexports } = parseCommonJsExports(source);
            const nextMetadata = { code: source, names, reexports };
            this.commonJsExportNames.set(filePath, nextMetadata);
            return nextMetadata;
          })();

    const names = new Set(metadata.names);
    const moduleRequire = this.createRequire(filePath);
    for (const reexport of metadata.reexports) {
      let resolvedId: string;
      try {
        resolvedId = moduleRequire.resolve(reexport);
      } catch {
        continue;
      }
      if (getModuleFormat(resolvedId, 'require') !== 'commonjs') {
        continue;
      }
      for (const name of this.getCommonJsExportNamesFrom(
        getFilePath(resolvedId),
        visited,
      )) {
        names.add(name);
      }
    }
    return [...names];
  }

  private getJsonSyntheticModule(
    resolvedId: string,
    value: unknown,
  ): vm.SyntheticModule {
    return getOrCreateSyntheticModule(
      { default: value },
      resolvedId,
      value,
      this.context,
    );
  }

  private getJsonModule(resolvedId: string): vm.SyntheticModule {
    const identifier = resolvedId.startsWith('file:')
      ? resolvedId
      : pathToFileURL(resolvedId).href;
    const cached = this.esmJsonCache.get(identifier);
    if (cached !== undefined || this.esmJsonCache.has(identifier)) {
      return this.getJsonSyntheticModule(identifier, cached);
    }

    const url = new URL(identifier);
    const value =
      url?.search || url?.hash
        ? this.parseJsonSource(readSource(getFilePath(identifier)))
        : this.loadJson(getFilePath(identifier));
    this.esmJsonCache.set(identifier, value);
    return this.getJsonSyntheticModule(identifier, value);
  }

  private parseJsonSource(source: string): unknown {
    return this.parseJson(stripJsonBom(source));
  }

  private async loadDataModule(
    identifier: string,
    loadingWebAssemblyIds?: ReadonlySet<string>,
  ): Promise<vm.Module> {
    const { code, mime } = parseDataUri(identifier);
    if (mime === 'application/wasm') {
      return this.loadWebAssemblyModule(
        identifier,
        code,
        loadingWebAssemblyIds,
      );
    }
    if (mime === 'application/json') {
      return this.getJsonSyntheticModule(
        identifier,
        this.parseJsonSource(code),
      );
    }

    const cached = this.esmCache.get(identifier);
    if (cached) {
      return cached;
    }
    const module = this.createEsmModule(identifier, code);
    this.esmCache.set(identifier, module);
    return module;
  }

  private async loadWebAssemblyModule(
    identifier: string,
    source: Uint8Array,
    loadingWebAssemblyIds: ReadonlySet<string> = new Set(),
  ): Promise<vm.SyntheticModule> {
    const cached = this.webAssemblyCache.get(identifier);
    if (cached) {
      return loadingWebAssemblyIds.has(identifier)
        ? cached.module
        : cached.loading;
    }

    let resolveModule!: (module: vm.SyntheticModule) => void;
    let rejectModule!: (reason?: unknown) => void;
    const module = new Promise<vm.SyntheticModule>((resolve, reject) => {
      resolveModule = resolve;
      rejectModule = reject;
    });
    void module.catch(() => undefined);
    const loading = (async () => {
      const webAssembly = vm.runInContext(
        'WebAssembly',
        this.context,
      ) as typeof WebAssembly;
      const compiled = await webAssembly.compile(Buffer.from(source));
      const importObject: WebAssembly.Imports = {};
      const syntheticModule = new vm.SyntheticModule(
        webAssembly.Module.exports(compiled).map(({ name }) => name),
        () => {
          const instance = new webAssembly.Instance(compiled, importObject);
          for (const { name } of webAssembly.Module.exports(compiled)) {
            syntheticModule.setExport(name, instance.exports[name]);
          }
        },
        { context: this.context, identifier },
      );
      resolveModule(syntheticModule);
      const nextLoadingWebAssemblyIds = new Set(loadingWebAssemblyIds);
      nextLoadingWebAssemblyIds.add(identifier);
      const imports = webAssembly.Module.imports(compiled);
      const dependencies = new Map<string, vm.Module>();
      for (const { module: specifier } of imports) {
        if (!dependencies.has(specifier)) {
          dependencies.set(
            specifier,
            await this.getModule(
              this.resolve(specifier, identifier),
              this.interopDefault,
              nextLoadingWebAssemblyIds,
            ),
          );
        }
      }

      for (const { module: specifier, name } of imports) {
        const dependency = dependencies.get(specifier)!;
        await this.linkModule(
          dependency,
          this.interopDefault,
          nextLoadingWebAssemblyIds,
        );
        if (dependency.status !== 'evaluated') {
          await this.evaluateModule(dependency);
        }
        const namespace = dependency.namespace as Record<string, unknown>;
        const moduleImports = (importObject[specifier] ??= {});
        moduleImports[name] = namespace[name] as WebAssembly.ImportValue;
      }

      return syntheticModule;
    })();
    const entry = { module, loading };
    this.webAssemblyCache.set(identifier, entry);
    try {
      return await loading;
    } catch (error) {
      rejectModule(error);
      if (this.webAssemblyCache.get(identifier) === entry) {
        this.webAssemblyCache.delete(identifier);
      }
      throw error;
    }
  }

  private materializeSyncModule(
    identifier: string,
    forceEsmSource: boolean,
  ): { kind: 'ready'; module: vm.Module } | { code: string; kind: 'source' } {
    const format = getModuleFormat(identifier);
    switch (format) {
      case 'data': {
        const { code, mime } = parseDataUri(identifier);
        if (mime === 'application/wasm') {
          throw createRequireAsyncModuleError(
            this.context,
            identifier,
            'WebAssembly modules cannot be loaded synchronously',
          );
        }
        if (mime === 'application/json') {
          return {
            kind: 'ready',
            module: this.getJsonSyntheticModule(
              identifier,
              this.parseJsonSource(code),
            ),
          };
        }
        return { code, kind: 'source' };
      }
      case 'module':
        return {
          code: readSource(getFilePath(identifier)),
          kind: 'source',
        };
      case 'commonjs': {
        const commonJsPath = getFilePath(identifier);
        return forceEsmSource
          ? { code: readSource(commonJsPath), kind: 'source' }
          : {
              kind: 'ready',
              module: this.getCommonJsSyntheticModule(
                identifier,
                this.loadCommonJs(commonJsPath),
                this.interopDefault,
                this.getCommonJsExportNames(commonJsPath),
              ),
            };
      }
      case 'json': {
        return {
          kind: 'ready',
          module: this.getJsonModule(identifier),
        };
      }
      case 'native': {
        const nativePath = getFilePath(identifier);
        const exports = isBuiltin(identifier)
          ? this.loadBuiltin(identifier)
          : createNativeRequire(import.meta.url)(nativePath);
        return {
          kind: 'ready',
          module: this.getCommonJsSyntheticModule(identifier, exports),
        };
      }
      case 'wasm':
        throw createRequireAsyncModuleError(
          this.context,
          identifier,
          'WebAssembly modules cannot be loaded synchronously',
        );
      case 'unsupported':
        throw createUnsupportedFormatError(getFilePath(identifier));
    }
  }

  private attachChild(
    parentModule: CommonJsModule | undefined,
    childModule: CommonJsModule,
  ): void {
    if (!parentModule) {
      return;
    }
    childModule.parent ??= parentModule;
    if (!parentModule.children.includes(childModule)) {
      parentModule.children.push(childModule);
    }
  }

  private getRequireCacheEntry(
    filePath: string,
    parentModule?: CommonJsModule,
  ): { exports: unknown; hit: true } | { hit: false } {
    const entry = this.requireCache[filePath] as
      { exports: unknown } | undefined;
    if (!entry || !('exports' in entry)) {
      return { hit: false };
    }

    const internalModule =
      this.commonJsCache.get(filePath) ?? this.jsonCache.get(filePath);
    if (internalModule === entry) {
      this.attachChild(parentModule, internalModule);
    }
    return { exports: entry.exports, hit: true };
  }

  private loadCommonJs(
    filePath: string,
    parentModule?: CommonJsModule,
    onCompileSyntaxError?: (error: unknown) => unknown,
  ): unknown {
    if (this.esmSyntaxFallbackFiles.has(filePath)) {
      return this.requireEsm(filePath);
    }
    const requireCacheEntry = this.getRequireCacheEntry(filePath, parentModule);
    if (requireCacheEntry.hit) {
      return requireCacheEntry.exports;
    }

    let module: CommonJsModule;
    const moduleRequire = this.createRequire(filePath, () => module);
    module = new (this.getVmModuleClass())(filePath, parentModule);
    module.exports = vm.runInContext(
      'Object.create(Object.prototype)',
      this.context,
    );
    module.filename = filePath;
    module.id = filePath;
    module.loaded = false;
    module.path = nativeDirname(filePath);
    module.paths = getNodeModulePaths(filePath);
    module.require = moduleRequire;
    this.commonJsCache.set(filePath, module);
    this.requireCache[filePath] = module;
    this.attachChild(parentModule, module);

    const code = stripCommonJsPrefix(readSource(filePath));
    const wrappedCode = Module.wrap(code);
    const cached = getCommonJsCompilationCache(filePath);
    const cachedData = cached?.code === code ? cached.cachedData : undefined;
    const compile = (data?: Buffer): CommonJsScript => {
      const script = new vm.Script(wrappedCode, {
        filename: filePath,
        ...(data ? { cachedData: data } : {}),
        importModuleDynamically: staticCommonJsImportModuleDynamically,
      }) as CommonJsScript;
      script.identifier = filePath;
      return script;
    };

    let script: CommonJsScript;
    let shouldCacheCompilation = cachedData === undefined;
    try {
      script = compile(cachedData);
      if (cachedData && script.cachedDataRejected) {
        script = compile();
        shouldCacheCompilation = true;
      }
      scriptExecutors.set(script, this);
      this.scripts.add(script);
    } catch (error) {
      this.commonJsCache.delete(filePath);
      Reflect.deleteProperty(this.requireCache, filePath);
      if (
        supportsSyncEsmEvaluate &&
        extname(filePath) === '.js' &&
        isAmbiguousJavaScriptModule(filePath) &&
        isSyntaxError(error)
      ) {
        try {
          const exports = this.requireEsm(filePath, true);
          this.esmSyntaxFallbackFiles.add(filePath);
          return exports;
        } catch (esmError) {
          if (!isSyntaxError(esmError)) {
            throw esmError;
          }
        }
      }
      if (
        onCompileSyntaxError &&
        !supportsSyncEsmEvaluate &&
        extname(filePath) === '.js' &&
        isAmbiguousJavaScriptModule(filePath) &&
        isSyntaxError(error)
      ) {
        return onCompileSyntaxError(error);
      }
      throw error;
    }

    try {
      const fn = script.runInContext(this.context) as (
        exports: unknown,
        require: NodeJS.Require,
        module: CommonJsModule,
        filename: string,
        dirname: string,
      ) => void;
      fn.call(
        module.exports,
        module.exports,
        moduleRequire,
        module,
        filePath,
        nativeDirname(filePath),
      );
      module.loaded = true;
      if (shouldCacheCompilation) {
        setCommonJsCompilationCache(filePath, {
          code,
          cachedData: script.createCachedData(),
        });
      }
      return module.exports;
    } catch (error) {
      this.commonJsCache.delete(filePath);
      Reflect.deleteProperty(this.requireCache, filePath);
      throw error;
    }
  }

  private loadJson(filePath: string, parentModule?: CommonJsModule): unknown {
    const requireCacheEntry = this.getRequireCacheEntry(filePath, parentModule);
    if (requireCacheEntry.hit) {
      return requireCacheEntry.exports;
    }
    const module = new (this.getVmModuleClass())(
      filePath,
      parentModule,
    ) as CommonJsModule;
    module.exports = this.parseJsonSource(readSource(filePath));
    module.filename = filePath;
    module.id = filePath;
    module.loaded = true;
    module.path = nativeDirname(filePath);
    module.paths = getNodeModulePaths(filePath);
    module.require = this.createRequire(filePath);
    this.jsonCache.set(filePath, module);
    this.requireCache[filePath] = module;
    this.attachChild(parentModule, module);
    return module.exports;
  }

  private requireEsm(filePath: string, forceEsmSource = false): unknown {
    if (!supportsSyncEsmEvaluate) {
      throw createRequireEsmError(this.context, filePath);
    }
    const identifier = pathToFileURL(filePath).href;
    const module = this.requireEsModuleSync(identifier, forceEsmSource);
    if (Reflect.has(module.namespace, 'module.exports')) {
      return Reflect.get(module.namespace, 'module.exports');
    }
    const cachedNamespace = this.esmRequireNamespaceCache.get(identifier);
    if (cachedNamespace) {
      return cachedNamespace;
    }
    const namespace = module.namespace as Record<PropertyKey, unknown>;
    const forwardedNamespace = Reflect.has(namespace, 'default')
      ? this.createRequireEsmNamespace(namespace)
      : namespace;
    this.esmRequireNamespaceCache.set(identifier, forwardedNamespace);
    return forwardedNamespace;
  }

  private createRequireEsmNamespace(
    namespace: Record<PropertyKey, unknown>,
  ): Record<PropertyKey, unknown> {
    const forwardedNamespace = vm.runInContext(
      'Object.create(null)',
      this.context,
    ) as Record<PropertyKey, unknown>;

    for (const property of Reflect.ownKeys(namespace)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(namespace, property);
      if (!descriptor) {
        continue;
      }
      Object.defineProperty(forwardedNamespace, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: () => Reflect.get(namespace, property),
      });
    }

    if (!Reflect.has(namespace, '__esModule')) {
      Object.defineProperty(forwardedNamespace, '__esModule', {
        configurable: false,
        enumerable: true,
        value: true,
        writable: true,
      });
    }
    return Object.preventExtensions(forwardedNamespace);
  }

  private requireEsModuleSync(
    rootIdentifier: string,
    forceRootSource: boolean,
  ): SyncSourceTextModule {
    if (this.activeSyncRequireRoots.has(rootIdentifier)) {
      throw createRequireCycleError(this.context, rootIdentifier);
    }
    this.activeSyncRequireRoots.add(rootIdentifier);
    try {
      const cachedRoot = this.esmCache.get(rootIdentifier);
      if (cachedRoot) {
        return this.reuseSyncModule(rootIdentifier, cachedRoot);
      }

      // Keep new modules private until every dependency is proven synchronous.
      // A rejected require must not poison a later dynamic import of the graph.
      const scratch = new Map<string, SyncModuleEntry>();
      const pendingIdentifiers = [rootIdentifier];

      while (pendingIdentifiers.length > 0) {
        const identifier = pendingIdentifiers.pop()!;
        if (scratch.has(identifier)) {
          continue;
        }

        const cached = this.esmCache.get(identifier);
        if (cached) {
          scratch.set(identifier, {
            commit: false,
            module: this.reuseSyncModule(identifier, cached),
          });
          continue;
        }

        const disposition = this.materializeSyncModule(
          identifier,
          forceRootSource && identifier === rootIdentifier,
        );
        if (disposition.kind === 'ready') {
          scratch.set(identifier, {
            commit: false,
            module: disposition.module,
          });
          continue;
        }

        const module = this.createEsmModule(identifier, disposition.code);
        if (module.hasTopLevelAwait()) {
          throw createRequireAsyncModuleError(
            this.context,
            identifier,
            'the module uses top-level await',
          );
        }
        const dependencies = module.moduleRequests.map(
          ({ specifier, attributes }) => {
            const resolved = this.resolve(specifier, identifier);
            this.validateImportAttributes(resolved, attributes);
            return resolved;
          },
        );
        scratch.set(identifier, { commit: true, dependencies, module });
        for (const dependency of dependencies) {
          if (!scratch.has(dependency)) {
            pendingIdentifiers.push(dependency);
          }
        }
      }

      for (const entry of scratch.values()) {
        if (entry.commit) {
          entry.module.linkRequests(
            entry.dependencies.map(
              (dependency) => scratch.get(dependency)!.module,
            ),
          );
        }
      }

      const root = scratch.get(rootIdentifier)!;
      if (!root.commit) {
        throw new Error(
          `[rstest] Expected ${rootIdentifier} to be an ESM source module.`,
        );
      }
      root.module.instantiate();
      if (moduleHasAsyncGraph(root.module)) {
        throw createRequireAsyncModuleError(
          this.context,
          rootIdentifier,
          'its dependency graph uses top-level await',
        );
      }

      for (const [identifier, entry] of scratch) {
        if (entry.commit && !this.esmCache.has(identifier)) {
          this.esmCache.set(identifier, entry.module);
        }
      }

      // Once the graph has no TLA, V8 settles evaluate() before it returns. The
      // promise still needs a rejection handler while the synchronous status and
      // original evaluation error are read below.
      void this.evaluateModule(root.module).catch(() => undefined);
      if (root.module.status === 'errored') {
        throw root.module.error;
      }
      if (root.module.status !== 'evaluated') {
        throw new Error(
          `[rstest] Expected synchronous ESM evaluation to complete for ${rootIdentifier}, but the module status is "${root.module.status}".`,
        );
      }
      return root.module;
    } finally {
      this.activeSyncRequireRoots.delete(rootIdentifier);
    }
  }

  private reuseSyncModule(
    identifier: string,
    module: SyncSourceTextModule,
  ): SyncSourceTextModule {
    if (module.status === 'errored') {
      throw module.error;
    }
    if (module.status !== 'evaluated') {
      throw createConcurrentRequireError(this.context, identifier);
    }
    if (moduleHasAsyncGraph(module)) {
      throw createRequireAsyncModuleError(
        this.context,
        identifier,
        'the module uses top-level await',
      );
    }
    return module;
  }

  private async loadEsm(resolvedId: string): Promise<SyncSourceTextModule> {
    const identifier = resolvedId.startsWith('file:')
      ? resolvedId
      : pathToFileURL(resolvedId).href;
    const cachedModule = this.esmCache.get(identifier);
    if (cachedModule) {
      return cachedModule;
    }

    const filePath = getFilePath(identifier);
    const code = readSource(filePath);
    const module = this.createEsmModule(identifier, code);
    this.esmCache.set(identifier, module);
    return module;
  }

  private createEsmModule(
    identifier: string,
    code: string,
  ): SyncSourceTextModule {
    const cacheKey = identifier.startsWith('file:')
      ? getFilePath(identifier)
      : identifier;
    const cached = getEsmCompilationCache(cacheKey);
    const cachedData = cached?.code === code ? cached.cachedData : undefined;
    const module = new vm.SourceTextModule(code, {
      identifier,
      context: this.context,
      ...(cachedData ? { cachedData } : {}),
      initializeImportMeta: staticInitializeImportMeta,
      importModuleDynamically: staticImportModuleDynamically,
    }) as SyncSourceTextModule;

    if (!cachedData) {
      const createCachedData = (
        module as vm.SourceTextModule & { createCachedData?: () => Buffer }
      ).createCachedData;
      if (createCachedData) {
        setEsmCompilationCache(cacheKey, {
          code,
          cachedData: createCachedData.call(module),
        });
      }
    }

    return module;
  }

  private async linkModule(
    module: vm.Module,
    interopDefault: boolean,
    loadingWebAssemblyIds?: ReadonlySet<string>,
  ): Promise<void> {
    const existingOperation = this.esmLinkOperations.get(module.identifier);
    if (existingOperation) {
      await existingOperation.promise;
      return;
    }

    if (module.status === 'unlinked') {
      const operation = createEsmLinkOperation();
      this.esmLinkOperations.set(module.identifier, operation);
      void module
        .link(async (specifier, referencer, extra) => {
          const resolvedId = this.resolve(specifier, referencer.identifier);
          this.validateImportAttributes(
            resolvedId,
            extra.attributes as unknown as ExternalImportAttributes,
          );
          const dependency = await this.getModule(
            resolvedId,
            interopDefault,
            loadingWebAssemblyIds,
          );
          if (
            dependency.status === 'unlinked' ||
            dependency.status === 'linking'
          ) {
            const dependencyOperation = this.esmLinkOperations.get(
              dependency.identifier,
            );
            if (dependencyOperation && dependencyOperation !== operation) {
              await dependencyOperation.promise;
            } else if (!dependencyOperation) {
              this.esmLinkOperations.set(dependency.identifier, operation);
            }
          }
          return dependency;
        })
        .then(
          () => operation.resolve(module),
          (error: unknown) => {
            for (const [identifier, owner] of this.esmLinkOperations) {
              if (owner === operation) {
                this.esmCache.delete(identifier);
                this.esmLinkOperations.delete(identifier);
              }
            }
            operation.reject(error);
          },
        );
      await operation.promise;
    }
  }

  private loadBuiltin(specifier: string): unknown {
    const normalized = specifier.replace(/^node:/, '');
    const nativeRequire = createNativeRequire(import.meta.url);
    if (normalized === 'timers') {
      return this.loadVmTimers(
        nativeRequire(specifier) as Record<PropertyKey, unknown>,
      );
    }
    if (normalized === 'timers/promises') {
      return this.loadVmTimersPromises(
        nativeRequire(specifier) as Record<PropertyKey, unknown>,
      );
    }
    if (normalized !== 'module' && normalized !== 'process') {
      return this.wrapBuiltinModule(
        nativeRequire(specifier) as Record<PropertyKey, unknown>,
      );
    }

    if (normalized === 'process') {
      if (this.processBuiltin) {
        return this.processBuiltin;
      }
      this.processBuiltin = vm.runInContext('globalThis.process', this.context);
      return this.processBuiltin;
    }

    if (this.moduleBuiltin) {
      return this.moduleBuiltin;
    }

    const nativeModule = nativeRequire(specifier) as Record<
      PropertyKey,
      unknown
    >;
    let moduleBuiltin: unknown;
    moduleBuiltin = new Proxy(nativeModule, {
      get: (target, property, receiver) => {
        if (property === 'Module') {
          return this.getVmModuleClass();
        }
        if (property === 'createRequire') {
          return this.createRequire;
        }
        if (property === 'syncBuiltinESMExports') {
          return this.syncBuiltinESMExports;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    this.moduleBuiltin = moduleBuiltin;
    return moduleBuiltin;
  }

  private getVmModuleClass(): typeof Module {
    if (!this.moduleClass) {
      let vmModule: typeof Module;
      vmModule = new Proxy(Module, {
        get: (target, property, receiver) => {
          if (property === 'createRequire') {
            return this.createRequire;
          }
          if (property === 'syncBuiltinESMExports') {
            return this.syncBuiltinESMExports;
          }
          return Reflect.get(target, property, receiver);
        },
        construct: (target, args, newTarget) => {
          const instance = Reflect.construct(target, args, newTarget);
          Object.defineProperty(instance, 'constructor', {
            configurable: true,
            value: vmModule,
            writable: true,
          });
          return instance;
        },
      });
      this.moduleClass = vmModule;
    }
    return this.moduleClass;
  }

  private syncBuiltinESMExports = (): void => {
    const nativeModule = createNativeRequire(import.meta.url)(
      'node:module',
    ) as {
      syncBuiltinESMExports: () => void;
    };
    nativeModule.syncBuiltinESMExports();

    for (const {
      module,
      imported,
      overrides,
      wrapExports,
    } of this.builtinModuleRecords.values()) {
      if (module.status !== 'evaluated') {
        continue;
      }
      for (const name of Object.keys(imported)) {
        if (!overrides.has(name)) {
          module.setExport(
            name,
            wrapExports
              ? this.wrapBuiltinValue(imported[name])
              : imported[name],
          );
        }
      }
    }
  };

  private async loadNativeModule(resolvedId: string): Promise<vm.Module> {
    if (!isBuiltin(resolvedId.replace(/^node:/, ''))) {
      const exports = createNativeRequire(import.meta.url)(
        getFilePath(resolvedId),
      );
      return asModule(exports, resolvedId, exports, this.context);
    }

    const imported = await import(resolvedId);
    const normalized = resolvedId.replace(/^node:/, '');
    const overrides = new Set<string>();
    let exports: Record<string, unknown>;
    let defaultExport: unknown;
    if (normalized === 'timers' || normalized === 'timers/promises') {
      const timers = this.loadBuiltin(resolvedId) as Record<
        PropertyKey,
        unknown
      >;
      exports = { ...imported, default: timers };
      const overriddenExports =
        normalized === 'timers' ? VM_TIMER_EXPORTS : VM_PROMISE_TIMER_EXPORTS;
      for (const name of overriddenExports) {
        exports[name] = timers[name];
        overrides.add(name);
      }
      defaultExport = timers;
    } else if (normalized === 'module') {
      const moduleBuiltin = this.loadBuiltin(resolvedId);
      exports = {
        ...imported,
        Module: this.getVmModuleClass(),
        createRequire: this.createRequire,
        syncBuiltinESMExports: this.syncBuiltinESMExports,
        default: moduleBuiltin,
      };
      overrides.add('Module');
      overrides.add('createRequire');
      overrides.add('syncBuiltinESMExports');
      defaultExport = moduleBuiltin;
    } else if (normalized === 'process') {
      const runtimeProcess = vm.runInContext(
        'globalThis.process',
        this.context,
      ) as Record<string, unknown>;
      exports = { ...imported, default: runtimeProcess };
      for (const name of ['exit', 'kill']) {
        exports[name] = runtimeProcess[name];
        overrides.add(name);
      }
      defaultExport = runtimeProcess;
    } else {
      exports = this.wrapBuiltinExports(imported);
      defaultExport = exports.default;
    }

    const module = await asModule(
      exports,
      resolvedId,
      defaultExport,
      this.context,
    );
    this.builtinModuleRecords.set(resolvedId, {
      module,
      imported,
      overrides,
      wrapExports:
        normalized !== 'timers' &&
        normalized !== 'timers/promises' &&
        normalized !== 'module' &&
        normalized !== 'process',
    });
    return module;
  }

  private wrapBuiltinModule(
    module: Record<PropertyKey, unknown>,
  ): Record<PropertyKey, unknown> {
    return this.wrapBuiltinValue(module) as Record<PropertyKey, unknown>;
  }

  private wrapBuiltinExports(
    module: Record<string, unknown>,
  ): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    for (const name of Object.keys(module)) {
      exports[name] = this.wrapBuiltinValue(module[name]);
    }
    return exports;
  }

  private wrapBuiltinValue(value: unknown): unknown {
    if (typeof value === 'function') {
      if (this.isVmValue(value)) {
        return value;
      }
      const cached = this.wrappedBuiltinValues.get(value);
      if (cached) {
        return cached;
      }
      const wrapped = new Proxy(value, {
        apply: (target, thisArg, args) =>
          this.wrapBuiltinResult(
            Reflect.apply(target, this.unwrapBuiltinValue(thisArg), args),
          ),
        construct: (target, args, newTarget) =>
          Reflect.construct(target, args, newTarget),
      });
      this.wrappedBuiltinValues.set(value, wrapped);
      this.unwrappedBuiltinValues.set(wrapped, value);
      return wrapped;
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (this.isVmValue(value)) {
      return value;
    }

    const cached = this.wrappedBuiltinValues.get(value);
    if (cached) {
      return cached;
    }

    // Keep the native object as the proxy target so mutations made through a
    // VM default export remain visible to syncBuiltinESMExports().
    const wrapped = new Proxy(value, {
      defineProperty: (target, property, descriptor) =>
        Reflect.defineProperty(target, property, {
          ...descriptor,
          ...(Object.hasOwn(descriptor, 'value')
            ? { value: this.unwrapBuiltinValue(descriptor.value) }
            : {}),
        }),
      deleteProperty: (target, property) =>
        Reflect.deleteProperty(target, property),
      get: (target, property) => this.getBuiltinProperty(target, property),
      set: (target, property, newValue) =>
        Reflect.set(
          target,
          property,
          this.unwrapBuiltinValue(newValue),
          target,
        ),
    });
    this.wrappedBuiltinValues.set(value, wrapped);
    this.unwrappedBuiltinValues.set(wrapped, value);
    return wrapped;
  }

  private getBuiltinProperty(target: object, property: PropertyKey): unknown {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (descriptor && !descriptor.configurable) {
      if ('value' in descriptor && descriptor.writable === false) {
        return descriptor.value;
      }
      if ('get' in descriptor && descriptor.get === undefined) {
        return undefined;
      }
    }
    return this.wrapBuiltinValue(Reflect.get(target, property, target));
  }

  private unwrapBuiltinValue(value: unknown): unknown {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null
    ) {
      return value;
    }
    return this.unwrappedBuiltinValues.get(value) ?? value;
  }

  private wrapBuiltinResult(value: unknown): unknown {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    ) {
      return value;
    }
    if (typeof Reflect.get(value, 'then') === 'function') {
      return new this.vmPromise((resolve, reject) => {
        Promise.resolve(value as PromiseLike<unknown>).then(
          (result) => resolve(this.wrapBuiltinResultValue(result)),
          (error) => reject(this.wrapBuiltinError(error)),
        );
      });
    }
    return this.wrapBuiltinResultValue(value);
  }

  private wrapBuiltinError(error: unknown): unknown {
    // Native Error rejections need the current VM's prototype so standard
    // `instanceof Error` checks keep working inside the test context. Other
    // rejection reasons retain their original identity and realm.
    if (
      this.isVmError(error) ||
      !(error instanceof Error) ||
      error.constructor === this.vmError
    ) {
      return error;
    }

    const constructor = Reflect.get(error, 'constructor');
    const constructorName =
      typeof constructor === 'function'
        ? Reflect.get(constructor, 'name')
        : undefined;
    const ErrorConstructor =
      typeof constructorName === 'string'
        ? this.getVmErrorConstructor(constructorName)
        : this.vmError;
    const wrapped = new ErrorConstructor(error.message);
    for (const key of Reflect.ownKeys(error)) {
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (descriptor) {
        Object.defineProperty(wrapped, key, descriptor);
      }
    }
    return wrapped;
  }

  private wrapBuiltinResultValue(
    value: unknown,
    seen = new WeakMap<object, unknown>(),
  ): unknown {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      this.isVmValue(value)
    ) {
      return value;
    }
    const cached = seen.get(value);
    if (cached) {
      return cached;
    }
    if (Array.isArray(value)) {
      // Only copy realm-neutral data containers. Native handles such as
      // Buffer, streams, and typed arrays must retain their backing objects;
      // Error rejection reasons are handled separately above.
      const wrapped = vm.runInContext('[]', this.context) as unknown[];
      seen.set(value, wrapped);
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
          continue;
        }
        if ('value' in descriptor) {
          descriptor.value = this.wrapBuiltinResultValue(
            descriptor.value,
            seen,
          );
        }
        Object.defineProperty(wrapped, key, descriptor);
      }
      return wrapped;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }
    const wrapped = vm.runInContext(
      prototype === null ? 'Object.create(null)' : '({})',
      this.context,
    ) as Record<PropertyKey, unknown>;
    seen.set(value, wrapped);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        continue;
      }
      if ('value' in descriptor) {
        descriptor.value = this.wrapBuiltinResultValue(descriptor.value, seen);
      }
      Object.defineProperty(wrapped, key, descriptor);
    }
    return wrapped;
  }
}

export const getVmExternalModules = (
  context: vm.Context,
): VmExternalModules => {
  let executor = executors.get(context);
  if (!executor) {
    executor = new VmExternalModules(context);
    executors.set(context, executor);
  }
  return executor;
};

export const disposeVmExternalModules = (context: vm.Context): void => {
  const executor = executors.get(context);
  executors.delete(context);
  executor?.dispose();
};

export const clearVmExternalCompilationCache = (): void => {
  clearExternalModuleCache();
  executors = new WeakMap();
  scriptExecutors = new WeakMap();
};
