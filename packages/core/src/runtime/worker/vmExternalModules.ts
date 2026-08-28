import { existsSync, readFileSync } from 'node:fs';
import { createRequire as createNativeRequire, isBuiltin } from 'node:module';
import { dirname, extname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { asModule, getOrCreateSyntheticModule, interopModule } from './interop';
import { createVmTimersLoader, VM_TIMER_EXPORTS } from './timers';
import { workerCache } from './workerCache';

type ModuleFormat = 'commonjs' | 'json' | 'module' | 'native' | 'unsupported';
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

const importMetaResolve = import.meta.resolve?.bind(import.meta);
const sourceCache = workerCache.namespace<string>('external-source', (source) =>
  Buffer.byteLength(source),
);
const packageTypeCache = workerCache.namespace<'commonjs' | 'module'>(
  'external-package-type',
  () => 0,
);
type ExternalCompilationCacheEntry = { code: string; cachedData: Buffer };
const getCompilationCacheSize = ({
  code,
  cachedData,
}: ExternalCompilationCacheEntry): number =>
  Buffer.byteLength(code) + cachedData.byteLength;
const commonJsCompilationCache =
  workerCache.namespace<ExternalCompilationCacheEntry>(
    'external-commonjs-compilation',
    getCompilationCacheSize,
  );
const esmCompilationCache =
  workerCache.namespace<ExternalCompilationCacheEntry>(
    'external-esm-compilation',
    getCompilationCacheSize,
  );

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

const readSource = (filePath: string): string => {
  let source = sourceCache.get(filePath);
  if (source === undefined) {
    source = readFileSync(filePath, 'utf8');
    sourceCache.set(filePath, source);
  }
  return source;
};

const resolvePackageType = (filePath: string): 'commonjs' | 'module' => {
  let directory = dirname(filePath);
  const visited: string[] = [];

  while (true) {
    const cached = packageTypeCache.get(directory);
    if (cached) {
      for (const item of visited) {
        packageTypeCache.set(item, cached);
      }
      return cached;
    }

    visited.push(directory);
    const packageJsonPath = join(directory, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readSource(packageJsonPath)) as {
        type?: unknown;
      };
      const type = packageJson.type === 'module' ? 'module' : 'commonjs';
      for (const item of visited) {
        packageTypeCache.set(item, type);
      }
      return type;
    }

    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) {
      for (const item of visited) {
        packageTypeCache.set(item, 'commonjs');
      }
      return 'commonjs';
    }
    directory = parent;
  }
};

const getFilePath = (resolvedId: string): string =>
  resolvedId.startsWith('file:')
    ? fileURLToPath(new URL(resolvedId))
    : resolvedId;

const getModuleFormat = (resolvedId: string): ModuleFormat => {
  if (isBuiltin(resolvedId)) {
    return 'native';
  }

  const filePath = getFilePath(resolvedId);
  switch (extname(filePath)) {
    case '':
      return resolvePackageType(filePath);
    case '.cjs':
      return 'commonjs';
    case '.json':
      return 'json';
    case '.mjs':
      return 'module';
    case '.js':
      return resolvePackageType(filePath);
    case '.node':
      return 'native';
    default:
      return 'unsupported';
  }
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
      case 'commonjs':
        return this.loadCommonJs(resolved, parentModule);
      case 'json':
        return this.loadJson(resolved, parentModule);
      case 'module':
        if (!supportsSyncEsmEvaluate) {
          throw createRequireEsmError(resolved);
        }
        return extname(resolved) === '.mjs'
          ? this.requireEsm(resolved)
          : this.loadCommonJs(resolved, parentModule);
      case 'native':
        return nativeRequire(resolved);
      case 'unsupported':
        throw createUnsupportedFormatError(resolved);
    }
  }

  async import(
    resolvedId: string,
    interopDefault: boolean,
    returnModule: boolean,
  ): Promise<unknown> {
    this.interopDefault = interopDefault;
    const module = await this.enqueueLinkedModule(resolvedId, interopDefault);
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
  ): Promise<vm.Module> {
    // Node may invoke sibling linker callbacks concurrently. Linking external
    // roots in parallel can split one cyclic graph into operations that wait on
    // each other. Queue linking only; evaluation remains concurrent and may
    // itself perform dynamic imports without deadlocking this queue.
    const linkedModule = this.linkQueue.then(async () => {
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

  private resolve(specifier: string, parent: string): string {
    if (isBuiltin(specifier)) {
      return specifier;
    }
    const parentUrl = parent.startsWith('file:')
      ? parent
      : pathToFileURL(parent).href;
    if (importMetaResolve) {
      return importMetaResolve(specifier, parentUrl);
    }
    return pathToFileURL(createNativeRequire(parentUrl).resolve(specifier))
      .href;
  }

  private async getModule(
    resolvedId: string,
    interopDefault: boolean,
  ): Promise<vm.Module> {
    const format = getModuleFormat(resolvedId);
    switch (format) {
      case 'module':
        return this.loadEsm(resolvedId, interopDefault);
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
      case 'unsupported':
        throw createUnsupportedFormatError(getFilePath(resolvedId));
    }
  }

  private getCommonJsSyntheticModule(
    resolvedId: string,
    exports: unknown,
    interopDefault = this.interopDefault,
  ): vm.SyntheticModule {
    const namespace =
      exports !== null &&
      (typeof exports === 'object' || typeof exports === 'function')
        ? Object.assign({ default: exports }, exports)
        : { default: exports };
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

  private materializeSyncModule(
    identifier: string,
    forceEsmSource: boolean,
  ): { kind: 'ready'; module: vm.Module } | { code: string; kind: 'source' } {
    const format = getModuleFormat(identifier);
    const filePath = getFilePath(identifier);
    switch (format) {
      case 'module':
        return { code: readSource(filePath), kind: 'source' };
      case 'commonjs':
        return forceEsmSource
          ? { code: readSource(filePath), kind: 'source' }
          : {
              kind: 'ready',
              module: this.getCommonJsSyntheticModule(
                identifier,
                this.loadCommonJs(filePath),
              ),
            };
      case 'json':
        return {
          kind: 'ready',
          module: this.getJsonSyntheticModule(
            identifier,
            this.loadJson(filePath),
          ),
        };
      case 'native': {
        const exports = isBuiltin(identifier)
          ? this.loadBuiltin(identifier)
          : createNativeRequire(import.meta.url)(filePath);
        return {
          kind: 'ready',
          module: this.getCommonJsSyntheticModule(identifier, exports),
        };
      }
      case 'unsupported':
        throw createUnsupportedFormatError(filePath);
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

  private loadCommonJs(
    filePath: string,
    parentModule?: CommonJsModule,
  ): unknown {
    if (this.esmSyntaxFallbackFiles.has(filePath)) {
      return this.requireEsm(filePath);
    }
    const cachedModule = this.commonJsCache.get(filePath);
    if (cachedModule) {
      this.attachChild(parentModule, cachedModule);
      return cachedModule.exports;
    }
    const injectedModule = this.requireCache[filePath] as
      { exports: unknown } | undefined;
    if (injectedModule && 'exports' in injectedModule) {
      return injectedModule.exports;
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
    const cached = commonJsCompilationCache.get(filePath);
    const cachedData = cached?.code === code ? cached.cachedData : undefined;
    const compile = (data?: Buffer) =>
      vm.compileFunction(
        code,
        ['exports', 'require', 'module', '__filename', '__dirname'],
        {
          filename: filePath,
          parsingContext: this.context,
          ...(data ? { cachedData: data } : { produceCachedData: true }),
          importModuleDynamically: (specifier) =>
            this.import(
              this.resolve(specifier, pathToFileURL(filePath).href),
              true,
              true,
            ) as Promise<vm.Module>,
        },
      );

    let fn: ReturnType<typeof compile>;
    try {
      fn = compile(cachedData);
      if (cachedData && fn.cachedDataRejected) {
        fn = compile();
      }
      if (fn.cachedDataProduced && fn.cachedData) {
        commonJsCompilationCache.set(filePath, {
          code,
          cachedData: fn.cachedData,
        });
      }
    } catch (error) {
      this.commonJsCache.delete(filePath);
      Reflect.deleteProperty(this.requireCache, filePath);
      if (
        supportsSyncEsmEvaluate &&
        extname(filePath) === '.js' &&
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
      fn.call(
        module.exports,
        module.exports,
        module.require,
        module,
        filePath,
        dirname(filePath),
      );
      module.loaded = true;
      return module.exports;
    } catch (error) {
      this.commonJsCache.delete(filePath);
      Reflect.deleteProperty(this.requireCache, filePath);
      throw error;
    }
  }

  private loadJson(filePath: string, parentModule?: CommonJsModule): unknown {
    let module = this.jsonCache.get(filePath);
    if (!module) {
      const injectedModule = this.requireCache[filePath] as
        { exports: unknown } | undefined;
      if (injectedModule && 'exports' in injectedModule) {
        return injectedModule.exports;
      }
    }
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

      const module = this.createEsmModule(
        identifier,
        disposition.code,
        this.interopDefault,
      );
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

  private async loadEsm(
    resolvedId: string,
    interopDefault: boolean,
  ): Promise<SyncSourceTextModule> {
    const identifier = resolvedId.startsWith('file:')
      ? resolvedId
      : pathToFileURL(resolvedId).href;
    const cachedModule = this.esmCache.get(identifier);
    if (cachedModule) {
      return cachedModule;
    }

    const filePath = getFilePath(identifier);
    const code = readSource(filePath);
    const module = this.createEsmModule(identifier, code, interopDefault);
    this.esmCache.set(identifier, module);
    return module;
  }

  private createEsmModule(
    identifier: string,
    code: string,
    interopDefault: boolean,
  ): SyncSourceTextModule {
    const filePath = getFilePath(identifier);
    const cached = esmCompilationCache.get(filePath);
    const cachedData = cached?.code === code ? cached.cachedData : undefined;
    const module = new vm.SourceTextModule(code, {
      identifier,
      context: this.context,
      ...(cachedData ? { cachedData } : {}),
      initializeImportMeta: (meta) => {
        meta.url = identifier;
        meta.filename = filePath;
        meta.dirname = dirname(filePath);
        meta.resolve = (specifier: string) =>
          this.resolve(specifier, identifier);
      },
      importModuleDynamically: async (specifier, referencer) => {
        const imported = await this.enqueueLinkedModule(
          this.resolve(specifier, referencer.identifier),
          interopDefault,
        );
        if (
          imported.status !== 'evaluated' &&
          imported.status !== 'evaluating'
        ) {
          await imported.evaluate();
        }
        return imported;
      },
    }) as SyncSourceTextModule;

    if (!cachedData) {
      const createCachedData = (
        module as vm.SourceTextModule & { createCachedData?: () => Buffer }
      ).createCachedData;
      if (createCachedData) {
        esmCompilationCache.set(filePath, {
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
        .link(async (specifier, referencer) => {
          const dependency = await this.getModule(
            this.resolve(specifier, referencer.identifier),
            interopDefault,
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
        return Reflect.get(target, property, receiver);
      },
    });
    this.moduleBuiltin = moduleBuiltin;
    return moduleBuiltin;
  }

  private async loadNativeModule(resolvedId: string): Promise<vm.Module> {
    if (!isBuiltin(resolvedId.replace(/^node:/, ''))) {
      const exports = createNativeRequire(import.meta.url)(
        getFilePath(resolvedId),
      );
      return asModule(exports, resolvedId, exports, this.context);
    }

    const imported = await import(resolvedId);
    const normalized = resolvedId.replace(/^node:/, '');
    if (normalized === 'timers') {
      const timers = this.loadBuiltin(resolvedId) as Record<
        PropertyKey,
        unknown
      >;
      const exports = { ...imported, default: timers };
      for (const name of VM_TIMER_EXPORTS) {
        exports[name] = timers[name];
      }
      return asModule(exports, resolvedId, timers, this.context);
    }
    if (normalized !== 'module') {
      return asModule(imported, resolvedId, imported.default, this.context);
    }

    const moduleBuiltin = this.loadBuiltin(resolvedId);
    const exports = {
      ...imported,
      Module: moduleBuiltin,
      createRequire: this.createRequire,
      default: moduleBuiltin,
    };
    return asModule(exports, resolvedId, moduleBuiltin, this.context);
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

export const clearVmExternalCompilationCache = (): void => {
  sourceCache.clear();
  packageTypeCache.clear();
  commonJsCompilationCache.clear();
  esmCompilationCache.clear();
  executors = new WeakMap();
};
