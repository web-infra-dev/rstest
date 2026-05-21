import { builtinEnvironments } from '../environments';
import { resolveEnvironmentExport } from '../../core/resolveTestEnvironment';
import type { TestEnvironment } from '../../types';

export const loadTestEnvironment = async (
  name: string,
  resolvedPath?: string,
): Promise<TestEnvironment> => {
  if (Object.hasOwn(builtinEnvironments, name)) {
    return builtinEnvironments[name as keyof typeof builtinEnvironments];
  }

  if (!resolvedPath) {
    throw new Error(
      `Failed to resolve testEnvironment "${name}". Use a built-in environment name, an installed package, or a relative/absolute JavaScript file path.`,
    );
  }

  const environmentModule = await import(resolvedPath);
  const environment = resolveEnvironmentExport(environmentModule);

  if (!environment) {
    throw new Error(
      `Invalid testEnvironment module "${name}". It must export a test environment object as the default export.`,
    );
  }

  return environment;
};
