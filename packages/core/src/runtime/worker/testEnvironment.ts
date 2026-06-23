import { builtinEnvironments } from '../environments';
import type { TestEnvironment } from '../../types';

const isTestEnvironment = (value: unknown): value is TestEnvironment => {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'setup' in value &&
    typeof value.setup === 'function',
  );
};

const resolveEnvironmentExport = (
  environmentModule: unknown,
): TestEnvironment | undefined => {
  if (!environmentModule || typeof environmentModule !== 'object') {
    return undefined;
  }

  if (
    'default' in environmentModule &&
    isTestEnvironment(environmentModule.default)
  ) {
    return environmentModule.default;
  }

  return undefined;
};

const createInvalidTestEnvironmentError = (name: string) =>
  new Error(
    `Invalid testEnvironment module "${name}". It must export a test environment object as the default export.`,
  );

const createImportTestEnvironmentError = (
  name: string,
  resolvedPath: string,
  cause: unknown,
) =>
  new Error(
    `Failed to import testEnvironment module "${name}" from ${resolvedPath}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    { cause },
  );

const withImportCacheKey = (
  resolvedPath: string,
  cacheKey?: string,
): string => {
  if (!cacheKey) {
    return resolvedPath;
  }

  const url = new URL(resolvedPath);
  url.searchParams.set('rstest_env_cache_key', cacheKey);
  return url.href;
};

export const loadTestEnvironment = async (
  name: string,
  resolvedPaths?: string[],
  cacheKey?: string,
): Promise<TestEnvironment> => {
  if (Object.hasOwn(builtinEnvironments, name)) {
    return builtinEnvironments[name as keyof typeof builtinEnvironments];
  }

  if (!resolvedPaths?.length) {
    throw new Error(
      `Failed to resolve testEnvironment "${name}". Use a built-in environment name, an installed package, or a relative/absolute JavaScript file path.`,
    );
  }

  let lastImportError: { resolvedPath: string; error: unknown } | undefined;

  for (const resolvedPath of resolvedPaths) {
    let environmentModule: unknown;
    try {
      environmentModule = await import(
        withImportCacheKey(resolvedPath, cacheKey)
      );
    } catch (error) {
      lastImportError = { resolvedPath, error };
      continue;
    }

    const environment = resolveEnvironmentExport(environmentModule);

    if (environment) {
      return environment;
    }
  }

  if (lastImportError) {
    throw createImportTestEnvironmentError(
      name,
      lastImportError.resolvedPath,
      lastImportError.error,
    );
  }

  throw createInvalidTestEnvironmentError(name);
};
