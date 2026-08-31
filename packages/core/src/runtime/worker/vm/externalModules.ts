import { readFileSync } from 'node:fs';
import {
  createRequire as createNativeRequire,
  isBuiltin,
  Module,
} from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { dirname, extname } from 'pathe';
import {
  asModule,
  getOrCreateSyntheticModule,
  interopModule,
} from '../interop';
import { createVmTimersLoader, VM_TIMER_EXPORTS } from './timers';
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
  readonly moduleRequests: readonly { specifier: string }[];
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

type CommonJsModule = {
  children: CommonJsModule[];
  exports: unknown;
  filename: string;
  id: string;
  isPreloading: boolean;
  loaded: boolean;
  parent: CommonJsModule | null;
  path: string;
  paths: string[];
  require: NodeJS.Require;
};

type BuiltinModuleRecord = {
  module: vm.SyntheticModule;
  imported: Record<string, unknown>;
  overrides: Set<string>;
};

// `hasAsyncGraph` ships with the complete synchronous graph API that Node
// itself uses for require(esm): moduleRequests, linkRequests and instantiate.
const supportsSyncEsmEvaluate =
  typeof vm.SourceTextModule !== 'undefined' &&
  typeof Reflect.get(vm.SourceTextModule.prototype, 'hasAsyncGraph') ===
    'function';

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
  if (identifier.startsWith('file:')) {
    const filePath = getFilePath(identifier);
    meta.filename = filePath;
    meta.dirname = dirname(filePath);
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

const createRequireEsmError = (filePath: string): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(
    `require() of ES Module ${filePath} is not supported in the vmThreads pool. Use dynamic import() instead.`,
  );
  error.code = 'ERR_REQUIRE_ESM';
  return error;
};

const createRequireAsyncModuleError = (
  identifier: string,
  detail: string,
): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(
    `require() cannot be used to load ES Module ${identifier}: ${detail}. Use import() instead.`,
  );
  error.code = 'ERR_REQUIRE_ASYNC_MODULE';
  return error;
};

const createConcurrentRequireError = (
  identifier: string,
): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(
    `Cannot require() ES Module ${identifier} synchronously because it is currently being loaded by import().`,
  );
  error.code = 'ERR_REQUIRE_ESM';
  return error;
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
  code:
    | 'ERR_IMPORT_ATTRIBUTE_MISSING'
    | 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE'
    | 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
  message: string,
): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
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
  private readonly esmLinkOperations = new Map<string, EsmLinkOperation>();
  private readonly esmSyntaxFallbackFiles = new Set<string>();
  private readonly jsonCache = new Map<string, CommonJsModule>();
  private readonly loadVmTimers: ReturnType<typeof createVmTimersLoader>;
  private readonly parseJson: (source: string) => unknown;
  private readonly requireCache: NodeJS.Require['cache'];
  private readonly scripts = new Set<vm.Script>();
  private readonly webAssemblyCache = new Map<
    string,
    Promise<vm.SyntheticModule>
  >();
  private readonly builtinModuleRecords = new Map<
    string,
    BuiltinModuleRecord
  >();
  private linkQueue: Promise<void> = Promise.resolve();
  private moduleBuiltin: unknown;
  private interopDefault = true;

  constructor(private readonly context: vm.Context) {
    this.loadVmTimers = createVmTimersLoader(
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
      (specifier: string, options?: { paths?: string[] }) =>
        resolveRequire(nativeRequire, specifier, options),
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
    const resolved = resolveRequire(nativeRequire, specifier);
    switch (getModuleFormat(resolved)) {
      case 'data':
        throw createRequireEsmError(resolved);
      case 'commonjs':
        return this.loadCommonJs(resolved, parentModule);
      case 'json':
        return this.loadJson(resolved, parentModule);
      case 'module':
        if (!supportsSyncEsmEvaluate) {
          throw createRequireEsmError(resolved);
        }
        return this.requireEsm(resolved);
      case 'native':
        return nativeRequire(resolved);
      case 'wasm':
        throw createRequireAsyncModuleError(
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
    if (module.status !== 'evaluated' && module.status !== 'evaluating') {
      await module.evaluate();
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
    if (imported.status !== 'evaluated' && imported.status !== 'evaluating') {
      await imported.evaluate();
    }
    return imported;
  }

  dispose(): void {
    for (const script of this.scripts) {
      scriptExecutors.delete(script);
    }
    this.scripts.clear();
  }

  private async getModule(
    resolvedId: string,
    interopDefault: boolean,
  ): Promise<vm.Module> {
    const format = getModuleFormat(resolvedId);
    switch (format) {
      case 'data':
        return this.loadDataModule(resolvedId);
      case 'module':
        return this.loadEsm(resolvedId);
      case 'commonjs':
        return this.getCommonJsSyntheticModule(
          resolvedId,
          this.loadCommonJs(getFilePath(resolvedId)),
          interopDefault,
        );
      case 'json':
        return this.getJsonSyntheticModule(
          resolvedId,
          this.loadJson(getFilePath(resolvedId)),
        );
      case 'native':
        return this.loadNativeModule(resolvedId);
      case 'wasm':
        return this.loadWebAssemblyModule(
          resolvedId,
          readFileSync(getFilePath(resolvedId)),
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
          'ERR_IMPORT_ATTRIBUTE_MISSING',
          `Module "${resolvedId}" needs an import attribute of "type: json"`,
        );
      }
      if (type !== 'json') {
        throw createImportAttributeError(
          'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
          `Import attribute "type" with value "${type}" is not supported in ${resolvedId}`,
        );
      }
      const unsupported = attributeNames.find((name) => name !== 'type');
      if (unsupported) {
        throw createImportAttributeError(
          'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
          `Import attribute "${unsupported}" with value "${attributes[unsupported]}" is not supported in ${resolvedId}`,
        );
      }
      return;
    }

    if (type === 'json') {
      throw createImportAttributeError(
        'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE',
        'Module "' + resolvedId + '" is not of type "json"',
      );
    }

    if (attributeNames.length > 0) {
      const unsupported = attributeNames[0]!;
      throw createImportAttributeError(
        'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',
        `Import attribute "${unsupported}" with value "${attributes[unsupported]}" is not supported in ${resolvedId}`,
      );
    }
  }

  private getCommonJsSyntheticModule(
    resolvedId: string,
    exports: unknown,
    interopDefault = this.interopDefault,
  ): vm.SyntheticModule {
    const namespace: Record<string, any> =
      exports !== null &&
      (typeof exports === 'object' || typeof exports === 'function')
        ? Object.defineProperties(
            {},
            Object.fromEntries(
              Object.getOwnPropertyNames(exports)
                .filter((name) => name !== 'default')
                .map((name) => [
                  name,
                  Object.getOwnPropertyDescriptor(exports, name)!,
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
      { value: exports },
    );
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

  private async loadDataModule(identifier: string): Promise<vm.Module> {
    const { code, mime } = parseDataUri(identifier);
    if (mime === 'application/wasm') {
      return this.loadWebAssemblyModule(identifier, code);
    }
    if (mime === 'application/json') {
      return this.getJsonSyntheticModule(identifier, this.parseJson(code));
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
  ): Promise<vm.SyntheticModule> {
    const cached = this.webAssemblyCache.get(identifier);
    if (cached) {
      return cached;
    }

    const loading = (async () => {
      const compiled = await WebAssembly.compile(Buffer.from(source));
      const imports = WebAssembly.Module.imports(compiled);
      const dependencies = new Map<string, vm.Module>();
      for (const { module: specifier } of imports) {
        if (!dependencies.has(specifier)) {
          dependencies.set(
            specifier,
            await this.getModule(
              this.resolve(specifier, identifier),
              this.interopDefault,
            ),
          );
        }
      }

      const importObject: WebAssembly.Imports = {};
      for (const { module: specifier, name } of imports) {
        const dependency = dependencies.get(specifier)!;
        await this.linkModule(dependency, this.interopDefault);
        if (
          dependency.status !== 'evaluated' &&
          dependency.status !== 'evaluating'
        ) {
          await dependency.evaluate();
        }
        const namespace = dependency.namespace as Record<string, unknown>;
        const moduleImports = (importObject[specifier] ??= {});
        moduleImports[name] = namespace[name] as WebAssembly.ImportValue;
      }

      const syntheticModule = new vm.SyntheticModule(
        WebAssembly.Module.exports(compiled).map(({ name }) => name),
        () => {
          const instance = new WebAssembly.Instance(compiled, importObject);
          for (const { name } of WebAssembly.Module.exports(compiled)) {
            syntheticModule.setExport(name, instance.exports[name]);
          }
        },
        { context: this.context, identifier },
      );
      return syntheticModule;
    })();
    this.webAssemblyCache.set(identifier, loading);
    try {
      return await loading;
    } catch (error) {
      this.webAssemblyCache.delete(identifier);
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
            identifier,
            'WebAssembly modules cannot be loaded synchronously',
          );
        }
        if (mime === 'application/json') {
          return {
            kind: 'ready',
            module: this.getJsonSyntheticModule(
              identifier,
              this.parseJson(code),
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
              ),
            };
      }
      case 'json': {
        const jsonPath = getFilePath(identifier);
        return {
          kind: 'ready',
          module: this.getJsonSyntheticModule(
            identifier,
            this.loadJson(jsonPath),
          ),
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
    module = {
      children: [],
      exports: vm.runInContext('Object.create(Object.prototype)', this.context),
      filename: filePath,
      id: filePath,
      isPreloading: false,
      loaded: false,
      parent: parentModule ?? null,
      path: dirname(filePath),
      paths: getNodeModulePaths(filePath),
      require: moduleRequire,
    };
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
        module.require,
        module,
        filePath,
        dirname(filePath),
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
    let module = this.jsonCache.get(filePath);
    if (!module) {
      module = {
        children: [],
        exports: this.parseJson(readSource(filePath)),
        filename: filePath,
        id: filePath,
        isPreloading: false,
        loaded: true,
        parent: parentModule ?? null,
        path: dirname(filePath),
        paths: getNodeModulePaths(filePath),
        require: this.createRequire(filePath),
      };
      this.jsonCache.set(filePath, module);
      this.requireCache[filePath] = module;
    } else {
      this.jsonCache.set(filePath, module);
    }
    this.attachChild(parentModule, module);
    return module.exports;
  }

  private requireEsm(filePath: string, forceEsmSource = false): unknown {
    if (!supportsSyncEsmEvaluate) {
      throw createRequireEsmError(filePath);
    }
    const identifier = pathToFileURL(filePath).href;
    const module = this.requireEsModuleSync(identifier, forceEsmSource);
    return Reflect.has(module.namespace, 'module.exports')
      ? Reflect.get(module.namespace, 'module.exports')
      : module.namespace;
  }

  private requireEsModuleSync(
    rootIdentifier: string,
    forceRootSource: boolean,
  ): SyncSourceTextModule {
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
          identifier,
          'the module uses top-level await',
        );
      }
      const dependencies = module.moduleRequests.map(({ specifier }) =>
        this.resolve(specifier, identifier),
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
    void root.module.evaluate().catch(() => undefined);
    if (root.module.status === 'errored') {
      throw root.module.error;
    }
    if (root.module.status !== 'evaluated') {
      throw new Error(
        `[rstest] Expected synchronous ESM evaluation to complete for ${rootIdentifier}, but the module status is "${root.module.status}".`,
      );
    }
    return root.module;
  }

  private reuseSyncModule(
    identifier: string,
    module: SyncSourceTextModule,
  ): SyncSourceTextModule {
    if (module.status === 'errored') {
      throw module.error;
    }
    if (module.status !== 'evaluated') {
      throw createConcurrentRequireError(identifier);
    }
    if (moduleHasAsyncGraph(module)) {
      throw createRequireAsyncModuleError(
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
          const dependency = await this.getModule(resolvedId, interopDefault);
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
    if (normalized !== 'module') {
      return nativeRequire(specifier);
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
        if (property === 'createRequire') {
          return this.createRequire;
        }
        if (property === 'Module') {
          return moduleBuiltin;
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
    } of this.builtinModuleRecords.values()) {
      if (module.status !== 'evaluated') {
        continue;
      }
      for (const name of Object.keys(imported)) {
        if (!overrides.has(name)) {
          module.setExport(name, imported[name]);
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
    let defaultExport = imported.default;
    if (normalized === 'timers') {
      const timers = this.loadBuiltin(resolvedId) as Record<
        PropertyKey,
        unknown
      >;
      exports = { ...imported, default: timers };
      for (const name of VM_TIMER_EXPORTS) {
        exports[name] = timers[name];
        overrides.add(name);
      }
      defaultExport = timers;
    } else if (normalized === 'module') {
      const moduleBuiltin = this.loadBuiltin(resolvedId);
      exports = {
        ...imported,
        Module: moduleBuiltin,
        createRequire: this.createRequire,
        syncBuiltinESMExports: this.syncBuiltinESMExports,
        default: moduleBuiltin,
      };
      overrides.add('Module');
      overrides.add('createRequire');
      overrides.add('syncBuiltinESMExports');
      defaultExport = moduleBuiltin;
    } else {
      exports = imported;
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
    });
    return module;
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
