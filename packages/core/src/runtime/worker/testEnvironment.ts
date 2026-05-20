import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestEnvironment } from '../../types';
import { builtinEnvironments } from '../environments';

const createRootRequire = (root: string) => {
  return createRequire(pathToFileURL(join(root, 'package.json')).href);
};

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

const resolveEnvironmentExport = (environmentModule: unknown) => {
  if (isTestEnvironment(environmentModule)) {
    return environmentModule;
  }

  if (!environmentModule || typeof environmentModule !== 'object') {
    return undefined;
  }

  if (
    'default' in environmentModule &&
    isTestEnvironment(environmentModule.default)
  ) {
    return environmentModule.default;
  }

  if (
    'environment' in environmentModule &&
    isTestEnvironment(environmentModule.environment)
  ) {
    return environmentModule.environment;
  }

  if (
    'default' in environmentModule &&
    environmentModule.default &&
    typeof environmentModule.default === 'object' &&
    'environment' in environmentModule.default &&
    isTestEnvironment(environmentModule.default.environment)
  ) {
    return environmentModule.default.environment;
  }

  return undefined;
};

const resolveEnvironmentPath = (name: string, roots: string[]) => {
  const candidates =
    name.startsWith('.') || isAbsolute(name)
      ? [name]
      : [name, `rstest-environment-${name}`];

  for (const root of roots) {
    const rootRequire = createRootRequire(root);

    for (const candidate of candidates) {
      try {
        return rootRequire.resolve(candidate);
      } catch {
        continue;
      }
    }
  }

  return undefined;
};

export const loadTestEnvironment = async (
  name: string,
  roots: string[],
): Promise<TestEnvironment> => {
  if (name in builtinEnvironments) {
    return builtinEnvironments[name as keyof typeof builtinEnvironments];
  }

  const resolvedPath = resolveEnvironmentPath(name, roots);

  if (!resolvedPath) {
    throw new Error(
      `Failed to resolve testEnvironment "${name}". Use a built-in environment name, an installed package, or a relative/absolute JavaScript file path.`,
    );
  }

  const environmentModule = await import(pathToFileURL(resolvedPath).href);
  const environment = resolveEnvironmentExport(environmentModule);

  if (!environment) {
    throw new Error(
      `Invalid testEnvironment module "${name}". It must export a test environment object as the default export or as a named \`environment\` export.`,
    );
  }

  return environment;
};