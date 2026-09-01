import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, extname, join, parse } from 'pathe';
import { workerCache } from './cache';

export type ExternalModuleFormat =
  'commonjs' | 'data' | 'json' | 'module' | 'native' | 'unsupported' | 'wasm';
export type ExternalModuleLoadMode = 'import' | 'require';

type PackageType = 'ambiguous' | 'commonjs' | 'module';

export type CommonJsCompilationCacheEntry = {
  cachedData: Buffer;
  code: string;
};

type EsmCompilationCacheEntry = {
  cachedData: Buffer;
  code: string;
};

export type ParsedDataUri =
  | { code: Buffer; mime: 'application/wasm' }
  | {
      code: string;
      mime: 'application/json' | 'text/javascript';
    };

const importMetaResolve = import.meta.resolve?.bind(import.meta);
const dataUriPattern =
  /^data:(?<mime>text\/javascript|application\/javascript|application\/json|application\/wasm)(?<parameters>(?:;[^,]*)*),(?<code>.*)$/i;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const createInvalidDataUrlError = (
  identifier: string,
): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(`Invalid URL: ${identifier}`);
  error.code = 'ERR_INVALID_URL';
  return error;
};

const decodeExternalBase64 = (code: string, identifier: string): Buffer => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(code);
  } catch {
    throw createInvalidDataUrlError(identifier);
  }
  const normalized = decoded.replace(/[ \t\n\r\f]/g, '');
  if (!base64Pattern.test(normalized)) {
    throw createInvalidDataUrlError(identifier);
  }
  return Buffer.from(normalized, 'base64');
};

type ExternalSourceCacheEntry = {
  mtimeNs: bigint;
  size: bigint;
  source: string;
};
const sourceCache = workerCache.namespace<ExternalSourceCacheEntry>(
  'external-source',
  ({ source }) => Buffer.byteLength(source),
);

export const stripJsonBom = (source: string): string =>
  source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

const packageTypeCache = workerCache.namespace<PackageType>(
  'external-package-type',
  () => 0,
);
const resolutionCache = workerCache.namespace<string>(
  'external-resolution',
  () => 0,
);
const getCompilationCacheSize = ({
  code,
  cachedData,
}: EsmCompilationCacheEntry): number =>
  Buffer.byteLength(code) + cachedData.byteLength;
const commonJsCompilationCache =
  workerCache.namespace<CommonJsCompilationCacheEntry>(
    'external-commonjs-compilation',
    getCompilationCacheSize,
  );
const esmCompilationCache = workerCache.namespace<EsmCompilationCacheEntry>(
  'external-esm-compilation',
  getCompilationCacheSize,
);

export const readExternalSource = (filePath: string): string => {
  const { mtimeNs, size } = statSync(filePath, { bigint: true });
  const cached = sourceCache.get(filePath);
  if (cached?.mtimeNs === mtimeNs && cached.size === size) {
    return cached.source;
  }
  const source = readFileSync(filePath, 'utf8');
  sourceCache.set(filePath, { mtimeNs, size, source });
  return source;
};

const resolvePackageType = (filePath: string): PackageType => {
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
      const packageJson = JSON.parse(
        stripJsonBom(readExternalSource(packageJsonPath)),
      ) as { type?: unknown };
      const type: PackageType =
        packageJson.type === 'module'
          ? 'module'
          : packageJson.type === 'commonjs'
            ? 'commonjs'
            : 'ambiguous';
      for (const item of visited) {
        packageTypeCache.set(item, type);
      }
      return type;
    }

    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) {
      for (const item of visited) {
        packageTypeCache.set(item, 'ambiguous');
      }
      return 'ambiguous';
    }
    directory = parent;
  }
};

export const isAmbiguousJavaScriptModule = (resolvedId: string): boolean => {
  if (resolvedId.startsWith('data:')) {
    return false;
  }
  const filePath = getExternalFilePath(resolvedId);
  const extension = extname(filePath);
  return (
    (extension === '' || extension === '.js') &&
    resolvePackageType(filePath) === 'ambiguous'
  );
};

export const getExternalFilePath = (resolvedId: string): string =>
  resolvedId.startsWith('file:')
    ? fileURLToPath(new URL(resolvedId))
    : resolvedId;

export const getExternalModuleFormat = (
  resolvedId: string,
  mode: ExternalModuleLoadMode = 'import',
): ExternalModuleFormat => {
  if (isBuiltin(resolvedId)) {
    return 'native';
  }
  if (resolvedId.startsWith('data:')) {
    return 'data';
  }

  const filePath = getExternalFilePath(resolvedId);
  switch (extname(filePath)) {
    case '':
      return mode === 'require' || resolvePackageType(filePath) !== 'module'
        ? 'commonjs'
        : 'module';
    case '.cjs':
      return 'commonjs';
    case '.json':
      return 'json';
    case '.mjs':
      return 'module';
    case '.js':
      return resolvePackageType(filePath) === 'module' ? 'module' : 'commonjs';
    case '.node':
      return 'native';
    case '.wasm':
      return 'wasm';
    default:
      return 'unsupported';
  }
};

export const parseExternalDataUri = (identifier: string): ParsedDataUri => {
  const dataUri = identifier.split('#', 1)[0]!;
  const match = dataUri.match(dataUriPattern);
  if (!match?.groups) {
    throw new Error(`Invalid data URL: ${identifier}`);
  }

  const { code, mime: rawMime, parameters = '' } = match.groups;
  if (code === undefined) {
    throw new Error(`Invalid data URL: ${identifier}`);
  }
  if (rawMime === undefined) {
    throw new Error('Invalid data URL MIME type: ' + identifier);
  }
  const mime = rawMime.toLowerCase();
  const encodings = parameters
    .split(';')
    .filter(Boolean)
    .map((parameter) => parameter.toLowerCase());
  const isBase64 = encodings.at(-1) === 'base64';
  if (mime === 'application/wasm') {
    if (!isBase64) {
      throw new Error(
        encodings.length
          ? `Invalid WebAssembly data URL encoding: ${encodings.join(';')}`
          : 'WebAssembly data URLs require base64 encoding',
      );
    }
    return {
      code: decodeExternalBase64(code, identifier),
      mime: 'application/wasm',
    };
  }

  return {
    code: isBase64
      ? decodeExternalBase64(code, identifier).toString()
      : decodeURIComponent(code),
    mime: mime === 'application/json' ? 'application/json' : 'text/javascript',
  };
};

export const resolveExternalSpecifier = (
  specifier: string,
  parent: string,
): string => {
  if (isBuiltin(specifier)) {
    return specifier.startsWith('node:') ? specifier : `node:${specifier}`;
  }
  if (specifier.startsWith('data:')) {
    return specifier;
  }
  const cacheKey = `${parent}\0${specifier}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(parent);
  const parentUrl =
    !isWindowsPath && /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(parent)
      ? parent
      : pathToFileURL(parent).href;
  const resolved = importMetaResolve
    ? importMetaResolve(specifier, parentUrl)
    : pathToFileURL(createRequire(parentUrl).resolve(specifier)).href;
  resolutionCache.set(cacheKey, resolved);
  return resolved;
};

export const getCommonJsCompilationCache = (
  filePath: string,
): CommonJsCompilationCacheEntry | undefined =>
  commonJsCompilationCache.get(filePath);

export const setCommonJsCompilationCache = (
  filePath: string,
  entry: CommonJsCompilationCacheEntry,
): void => commonJsCompilationCache.set(filePath, entry);

export const getEsmCompilationCache = (
  identifier: string,
): EsmCompilationCacheEntry | undefined => esmCompilationCache.get(identifier);

export const setEsmCompilationCache = (
  identifier: string,
  entry: EsmCompilationCacheEntry,
): void => esmCompilationCache.set(identifier, entry);

export const clearExternalModuleCache = (): void => {
  sourceCache.clear();
  packageTypeCache.clear();
  resolutionCache.clear();
  commonJsCompilationCache.clear();
  esmCompilationCache.clear();
};
