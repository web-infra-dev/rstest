import { existsSync, readFileSync } from 'node:fs';
import { createRequire as createNativeRequire, isBuiltin } from 'node:module';
import { dirname, extname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { asModule, interopModule } from './interop';

type ModuleFormat = 'commonjs' | 'json' | 'module' | 'native';

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
const sourceCache = new Map<string, string>();
const packageTypeCache = new Map<string, 'commonjs' | 'module'>();
const commonJsCompilationCache = new Map<
  string,
  { code: string; cachedData: Buffer }
>();
const esmCompilationCache = new Map<
  string,
  { code: string; cachedData: Buffer }
>();

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
  if (isBuiltin(resolvedId) || resolvedId.endsWith('.node')) {
    return 'native';
  }

  const filePath = getFilePath(resolvedId);
  switch (extname(filePath)) {
    case '.cjs':
      return 'commonjs';
    case '.json':
      return 'json';
    case '.mjs':
      return 'module';
    case '.js':
      return resolvePackageType(filePath);
    default:
      return 'native';
  }
};

const stripCommonJsPrefix = (source: string): string =>
  source.replace(/^\uFEFF/, '').replace(/^#!.*(?:\r?\n|$)/, '');

class VmExternalModules {
  private readonly commonJsCache = new Map<string, CommonJsModule>();
  private readonly esmCache = new Map<string, vm.Module>();
  private readonly jsonCache = new Map<string, unknown>();
  private readonly parseJson: (source: string) => unknown;
  private moduleBuiltin: unknown;

  constructor(private readonly context: vm.Context) {
    this.parseJson = vm.runInContext('JSON.parse', context) as (
      source: string,
    ) => unknown;
  }

  createRequire = (filename: string | URL): NodeJS.Require => {
    const nativeRequire = createNativeRequire(filename);
    const require = ((specifier: string) =>
      this.require(specifier, filename)) as NodeJS.Require;

    require.resolve = nativeRequire.resolve.bind(
      nativeRequire,
    ) as NodeJS.RequireResolve;
    require.resolve.paths = nativeRequire.resolve.paths.bind(
      nativeRequire.resolve,
    );
    require.main = nativeRequire.main;
    require.cache = nativeRequire.cache;
    require.extensions = nativeRequire.extensions;
    return require;
  };

  require(specifier: string, parent: string | URL): unknown {
    if (isBuiltin(specifier)) {
      return this.loadBuiltin(specifier);
    }

    const nativeRequire = createNativeRequire(parent);
    const resolved = nativeRequire.resolve(specifier);
    switch (getModuleFormat(resolved)) {
      case 'commonjs':
        return this.loadCommonJs(resolved);
      case 'json':
        return this.loadJson(resolved);
      case 'module':
      case 'native':
        return nativeRequire(resolved);
    }
  }

  async import(
    resolvedId: string,
    interopDefault: boolean,
    returnModule: boolean,
  ): Promise<unknown> {
    const module = await this.getModule(resolvedId, interopDefault);
    if (returnModule) {
      return module;
    }

    if (module.status !== 'evaluated') {
      await module.evaluate();
    }
    return module.namespace;
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
    }
  }

  private loadCommonJs(filePath: string): unknown {
    const cachedModule = this.commonJsCache.get(filePath);
    if (cachedModule) {
      return cachedModule.exports;
    }

    const module: CommonJsModule = {
      children: [],
      exports: vm.runInContext('Object.create(Object.prototype)', this.context),
      filename: filePath,
      id: filePath,
      isPreloading: false,
      loaded: false,
      parent: null,
      path: dirname(filePath),
      paths: [],
      require: this.createRequire(filePath),
    };
    this.commonJsCache.set(filePath, module);

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
      throw error;
    }
  }

  private loadJson(filePath: string): unknown {
    if (!this.jsonCache.has(filePath)) {
      this.jsonCache.set(filePath, this.parseJson(readSource(filePath)));
    }
    return this.jsonCache.get(filePath);
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
      return cachedModule as vm.SourceTextModule;
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
        const imported = await this.getModule(
          this.resolve(specifier, referencer.identifier),
          interopDefault,
        );
        if (imported.status !== 'evaluated') {
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

    try {
      await module.link((specifier, referencer) =>
        this.getModule(
          this.resolve(specifier, referencer.identifier),
          interopDefault,
        ),
      );
      return module;
    } catch (error) {
      this.esmCache.delete(identifier);
      throw error;
    }
  }

  private loadBuiltin(specifier: string): unknown {
    const normalized = specifier.replace(/^node:/, '');
    const nativeRequire = createNativeRequire(import.meta.url);
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
    const imported = await import(resolvedId);
    if (!isBuiltin(resolvedId.replace(/^node:/, ''))) {
      return asModule(imported, resolvedId, imported.default, this.context);
    }

    const normalized = resolvedId.replace(/^node:/, '');
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
