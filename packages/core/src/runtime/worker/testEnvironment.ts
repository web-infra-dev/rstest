import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestEnvironment } from '../../types';
import { builtinEnvironments } from '../environments';

// `import.meta.resolve()` needs a parent module URL. We synthesize one under
// each root so package resolution follows that root's node_modules without
// requiring a real file to exist on disk.
const environmentResolveBaseName = '__rstest_environment_resolve__.mjs';

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

  return undefined;
};

const resolveEnvironmentPaths = (name: string, roots: string[]) => {
  if (name.startsWith('.') || isAbsolute(name)) {
    for (const root of roots) {
      const candidatePath = isAbsolute(name) ? name : join(root, name);

      if (existsSync(candidatePath)) {
        return [pathToFileURL(candidatePath).href];
      }
    }

    return [];
  }

  const candidates = [name, `rstest-environment-${name}`];
  const resolvedPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    const resolveBase = pathToFileURL(
      join(root, environmentResolveBaseName),
    ).href;
    const require = createRequire(resolveBase);

    for (const candidate of candidates) {
      try {
        const resolvedPath = import.meta.resolve(candidate, resolveBase);
        if (!seenPaths.has(resolvedPath)) {
          seenPaths.add(resolvedPath);
          resolvedPaths.push(resolvedPath);
        }
      } catch {
        try {
          const resolvedPath = pathToFileURL(require.resolve(candidate)).href;
          if (!seenPaths.has(resolvedPath)) {
            seenPaths.add(resolvedPath);
            resolvedPaths.push(resolvedPath);
          }
        } catch {
          continue;
        }
      }
    }
  }

  return resolvedPaths;
};

export const loadTestEnvironment = async (
  name: string,
  roots: string[],
): Promise<TestEnvironment> => {
  if (Object.hasOwn(builtinEnvironments, name)) {
    return builtinEnvironments[name as keyof typeof builtinEnvironments];
  }

  const resolvedPaths = resolveEnvironmentPaths(name, roots);

  if (resolvedPaths.length === 0) {
    throw new Error(
      `Failed to resolve testEnvironment "${name}". Use a built-in environment name, an installed package, or a relative/absolute JavaScript file path.`,
    );
  }

  for (const resolvedPath of resolvedPaths) {
    const environmentModule = await import(resolvedPath);
    const environment = resolveEnvironmentExport(environmentModule);

    if (environment) {
      return environment;
    }
  }

  throw new Error(
    `Invalid testEnvironment module "${name}". It must export a test environment object as the default export.`,
  );
};
