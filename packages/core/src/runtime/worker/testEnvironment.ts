import { builtinEnvironments } from '../environments';
import { resolveEnvironmentExport } from '../../core/resolveTestEnvironment';
import type { TestEnvironment } from '../../types';

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

export const loadTestEnvironment = async (
  name: string,
  resolvedPaths?: string[],
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
      environmentModule = await import(resolvedPath);
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
