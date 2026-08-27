import { existsSync, readFileSync } from 'node:fs';
import { createRequire as createNativeRequire, isBuiltin } from 'node:module';
import { dirname, extname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { asModule, interopModule } from './interop';
import { createVmTimersLoader, VM_TIMER_EXPORTS } from './timers';
import { workerCache } from './workerCache';

type ModuleFormat = 'commonjs' | 'json' | 'module' | 'native' | 'unsupported';
type EsmLinkOperation = {
  promise: Promise<vm.Module>;
  reject: (reason?: unknown) => void;
  resolve: (value: vm.Module | PromiseLike<vm.Module>) => void;
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
  private readonly esmCache = new Map<string, vm.SourceTextModule>();
  private readonly esmLinkOperations = new Map<string, EsmLinkOperation>();
  private readonly jsonCache = new Map<string, CommonJsModule>();
  private readonly loadVmTimers: ReturnType<typeof createVmTimersLoader>;
  private readonly parseJson: (source: string) => unknown;
  private readonly requireCache: NodeJS.Require['cache'];
  private linkQueue: Promise<void> = Promise.resolve();
  private moduleBuiltin: unknown;

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

    require.resolve = nativeRequire.resolve.bind(
      nativeRequire,
    ) as NodeJS.RequireResolve;
    require.resolve.paths = nativeRequire.resolve.paths.bind(
      nativeRequire.resolve,
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
    const resolved = nativeRequire.resolve(specifier);
    switch (getModuleFormat(resolved)) {
      case 'commonjs':
        return this.loadCommonJs(resolved, parentModule);
      case 'json':
        return this.loadJson(resolved, parentModule);
      case 'module':
        // Native require(esm) would evaluate the module in Node's host realm,
        // bypassing the file VM and breaking isolation. A synchronous VM ESM
        // evaluator is not available on every supported Node release.
        throw createRequireEsmError(resolved);
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
      case 'json': {
        const exports =
          format === 'json'
            ? this.loadJson(getFilePath(resolvedId))
            : this.loadCommonJs(getFilePath(resolvedId));
        const namespace =
          exports !== null &&
          (typeof exports === 'object' || typeof exports === 'function')
            ? Object.assign({ default: exports }, exports)
            : { default: exports };
        const { mod, defaultExport } = interopDefault
          ? interopModule(namespace)
          : { mod: namespace, defaultExport: namespace.default };
        return asModule(mod, resolvedId, defaultExport, this.context);
      }
      case 'native':
        return this.loadNativeModule(resolvedId);
      case 'unsupported':
        throw createUnsupportedFormatError(getFilePath(resolvedId));
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

    try {
      let fn = compile(cachedData);
      if (cachedData && fn.cachedDataRejected) {
        fn = compile();
      }
      if (fn.cachedDataProduced && fn.cachedData) {
        commonJsCompilationCache.set(filePath, {
          code,
          cachedData: fn.cachedData,
        });
      }
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

  private async loadEsm(
    resolvedId: string,
    interopDefault: boolean,
  ): Promise<vm.SourceTextModule> {
    const identifier = resolvedId.startsWith('file:')
      ? resolvedId
      : pathToFileURL(resolvedId).href;
    const cachedModule = this.esmCache.get(identifier);
    if (cachedModule) {
      return cachedModule;
    }

    const filePath = getFilePath(identifier);
    const code = readSource(filePath);
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
    });
    this.esmCache.set(identifier, module);

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
