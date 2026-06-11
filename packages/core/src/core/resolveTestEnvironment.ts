import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rspack } from '@rsbuild/core';
import type { BuiltinEnvironmentName } from '../types';

const builtinEnvironmentNames = {
  node: true,
  jsdom: true,
  'happy-dom': true,
} satisfies Record<BuiltinEnvironmentName, true>;

const { resolver } = rspack.experiments;

const packageResolver = new resolver.ResolverFactory({
  conditionNames: ['node', 'import'],
  mainFields: ['main'],
});

const resolvePackageEnvironmentPaths = (name: string, roots: string[]) => {
  const candidates = [name, `rstest-environment-${name}`];
  const resolvedPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    for (const candidate of candidates) {
      const resolvedImportPath = resolvePackageImport(candidate, root);

      if (resolvedImportPath && !seenPaths.has(resolvedImportPath)) {
        seenPaths.add(resolvedImportPath);
        resolvedPaths.push(resolvedImportPath);
        continue;
      }
    }
  }

  return resolvedPaths;
};

const resolvePackageImport = (name: string, root: string) => {
  try {
    const { path } = packageResolver.sync(root, name);
    return path ? pathToFileURL(realpathSync(path)).href : undefined;
  } catch {
    return undefined;
  }
};

export const resolveTestEnvironmentPath = async (
  name: string,
  roots: string[],
): Promise<string[] | undefined> => {
  if (Object.hasOwn(builtinEnvironmentNames, name)) {
    return undefined;
  }

  if (name.startsWith('.') || isAbsolute(name)) {
    for (const root of roots) {
      const candidatePath = isAbsolute(name) ? name : join(root, name);

      if (!existsSync(candidatePath)) {
        continue;
      }

      return [pathToFileURL(candidatePath).href];
    }
  } else {
    const resolvedPaths = resolvePackageEnvironmentPaths(name, roots);

    if (resolvedPaths.length > 0) {
      return resolvedPaths;
    }
  }

  throw new Error(
    `Failed to resolve testEnvironment "${name}". Use a built-in environment name, an installed package, or a relative/absolute JavaScript file path.`,
  );
};
