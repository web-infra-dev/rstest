import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuiltinEnvironmentName } from '../types';

const environmentResolveBaseName = '__rstest_environment_resolve__.mjs';

const builtinEnvironmentNames = {
  node: true,
  jsdom: true,
  'happy-dom': true,
} satisfies Record<BuiltinEnvironmentName, true>;

const resolvePackageEnvironmentPaths = (name: string, roots: string[]) => {
  const candidates = [name, `rstest-environment-${name}`];
  const resolvedPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    const resolveBase = pathToFileURL(
      join(root, environmentResolveBaseName),
    ).href;
    const require = createRequire(resolveBase);

    for (const candidate of candidates) {
      const resolvedImportPath = resolvePackageImport(candidate, root);

      if (resolvedImportPath && !seenPaths.has(resolvedImportPath)) {
        seenPaths.add(resolvedImportPath);
        resolvedPaths.push(resolvedImportPath);
        continue;
      }

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

  return resolvedPaths;
};

const resolvePackageImport = (name: string, root: string) => {
  const [packageName, subpath] = parsePackageName(name);
  const packageDir = join(root, 'node_modules', packageName);
  const packageJsonPath = join(packageDir, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    exports?: unknown;
    main?: string;
  };
  const entry =
    subpath ??
    resolveExportsEntry(packageJson.exports) ??
    packageJson.main ??
    'index.js';
  const entryPath = join(packageDir, entry);

  if (!existsSync(entryPath)) {
    return undefined;
  }

  return pathToFileURL(realpathSync(entryPath)).href;
};

const parsePackageName = (name: string): [string, string | undefined] => {
  const parts = name.split('/');
  const packageName = name.startsWith('@')
    ? `${parts[0]}/${parts[1]}`
    : parts[0]!;
  const subpath = parts.slice(name.startsWith('@') ? 2 : 1).join('/');

  return [packageName, subpath ? subpath : undefined];
};

const resolveExportsEntry = (exports: unknown): string | undefined => {
  if (typeof exports === 'string') {
    return exports;
  }

  if (!exports || typeof exports !== 'object') {
    return undefined;
  }

  const exportsRecord = exports as Record<string, unknown>;

  for (const condition of ['import', 'node', 'default']) {
    if (condition in exportsRecord) {
      return resolveExportsEntry(exportsRecord[condition]);
    }
  }

  if ('.' in exportsRecord) {
    return resolveExportsEntry(exportsRecord['.']);
  }

  return undefined;
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
