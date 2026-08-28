import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, extname, join, parse } from 'pathe';
import { workerCache } from './workerCache';

export type ExternalModuleFormat =
  'commonjs' | 'data' | 'json' | 'module' | 'native' | 'unsupported' | 'wasm';

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
  /^data:(?<mime>text\/javascript|application\/json|application\/wasm)(?:;(?<encoding>charset=utf-8|base64))?,(?<code>.*)$/;
type ExternalSourceCacheEntry = {
  mtimeNs: bigint;
  size: bigint;
  source: string;
};
const sourceCache = workerCache.namespace<ExternalSourceCacheEntry>(
  'external-source',
  ({ source }) => Buffer.byteLength(source),
);
const packageTypeCache = workerCache.namespace<'commonjs' | 'module'>(
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
      const packageJson = JSON.parse(readExternalSource(packageJsonPath)) as {
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

export const getExternalFilePath = (resolvedId: string): string =>
  resolvedId.startsWith('file:')
    ? fileURLToPath(new URL(resolvedId))
    : resolvedId;

export const getExternalModuleFormat = (
  resolvedId: string,
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
    case '.wasm':
      return 'wasm';
    default:
      return 'unsupported';
  }
};

export const parseExternalDataUri = (identifier: string): ParsedDataUri => {
  const match = identifier.match(dataUriPattern);
  if (!match?.groups) {
    throw new Error(`Invalid data URL: ${identifier}`);
  }

  const { code, encoding, mime } = match.groups;
  if (code === undefined) {
    throw new Error(`Invalid data URL: ${identifier}`);
  }
  if (mime === 'application/wasm') {
    if (encoding !== 'base64') {
      throw new Error(
        encoding
          ? `Invalid WebAssembly data URL encoding: ${encoding}`
          : 'WebAssembly data URLs require base64 encoding',
      );
    }
    return { code: Buffer.from(code, 'base64'), mime };
  }

  if (mime !== 'application/json' && mime !== 'text/javascript') {
    throw new Error(`Invalid data URL MIME type: ${mime}`);
  }
  return {
    code:
      encoding === 'base64'
        ? Buffer.from(code, 'base64').toString()
        : decodeURIComponent(code),
    mime,
  };
};

export const resolveExternalSpecifier = (
  specifier: string,
  parent: string,
): string => {
  if (isBuiltin(specifier) || specifier.startsWith('data:')) {
    return specifier;
  }
  const cacheKey = `${parent}\0${specifier}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const parentUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(parent)
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
