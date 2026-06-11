// TODO(internal/adapter): this module ships as the `@rstest/core/internal/adapter`
// subpath export, but the first-party adapters bundle it into their own dist
// (`externals: { '@rstest/core/internal/adapter': false }`), so they keep no
// runtime dependency on a core subpath. The shipped `dist/adapter.{js,d.ts}`
// (~1.6KB JS) is therefore only a build-time resolution target — kept as an
// extension point for external adapter authors (who can consume it at runtime
// like `@rstest/browser` does with `internal/browser`). If that shipped copy is
// ever deemed unwanted, relocate this module to a private (unpublished)
// workspace package the adapters depend on, instead of core.
import { dirname, isAbsolute, normalize, resolve } from 'node:path';

/**
 * Build target shape(s) accepted across adapters: a single target string
 * (rsbuild / rslib `output.target`) or Rspack's `string | string[] | false`.
 */
export type AdapterBuildTarget = string | string[] | false | undefined;

/**
 * Resolve one `buildDependencies` entry to a stable, normalized path so every
 * adapter computes the same cache key for the same inputs. Single source for
 * the per-entry resolution that previously diverged across the three adapters
 * (e.g. rslib skipped `normalize()`).
 *
 * Relative entries resolve against the config file's directory when a
 * `configPath` is given, else against `root`. Callers choose the base by which
 * argument they pass: the rsbuild and rslib adapters pass `configPath` (build
 * deps are relative to the config file); the rspack adapter passes only `root`
 * (Rspack resolves deps relative to the build `context`).
 */
export const resolveCacheDependency = ({
  dependency,
  configPath,
  root,
}: {
  dependency: string;
  configPath?: string;
  root?: string;
}): string => {
  if (isAbsolute(dependency)) {
    return normalize(dependency);
  }
  if (configPath) {
    return normalize(resolve(dirname(configPath), dependency));
  }
  return root ? normalize(resolve(root, dependency)) : dependency;
};

/**
 * Structural shape of a bundler's `performance.buildCache`, kept structural so
 * core need not import each bundler's config type — the rsbuild and rslib
 * adapters pass their own (compatible) `buildCache` value.
 */
type AdapterBuildCache =
  | boolean
  | {
      buildDependencies?: string[];
      cacheDirectory?: string;
      cacheDigest?: Array<string | undefined>;
    };

/**
 * Normalized `performance.buildCache` that an adapter feeds to rstest.
 */
export type BuildCacheOutput =
  | boolean
  | {
      cacheDirectory?: string;
      cacheDigest?: Array<string | undefined>;
      buildDependencies?: string[];
    }
  | undefined;

/**
 * Map a bundler's `performance.buildCache` to rstest's, resolving every
 * `buildDependencies` entry through {@link resolveCacheDependency} and adding
 * the config file itself as a dependency. Single source shared by the rsbuild
 * and rslib adapters, whose mappings are otherwise identical (the rspack
 * adapter has its own, persistent-cache-shaped variant).
 */
export const resolveBuildCache = ({
  buildCache,
  configPath,
  root,
}: {
  buildCache?: AdapterBuildCache;
  configPath?: string;
  root?: string;
}): BuildCacheOutput => {
  if (buildCache === undefined) {
    return undefined;
  }
  if (buildCache === false) {
    return false;
  }
  if (buildCache === true) {
    return configPath ? { buildDependencies: [normalize(configPath)] } : true;
  }
  const buildDependencies = buildCache.buildDependencies?.map((dependency) =>
    resolveCacheDependency({ dependency, configPath, root }),
  );
  const nextBuildDependencies = configPath
    ? Array.from(new Set([...(buildDependencies || []), normalize(configPath)]))
    : buildDependencies;
  return {
    cacheDirectory: buildCache.cacheDirectory,
    cacheDigest: buildCache.cacheDigest,
    buildDependencies: nextBuildDependencies,
  };
};

/**
 * Whether a build target runs in Node (vs the browser). Recognizes Rspack's
 * `async-node` and any `node*` target, across single-string and array shapes.
 * Single source so adapters cannot drift on which targets count as Node.
 */
export const isNodeTarget = (target: AdapterBuildTarget): boolean => {
  const targets = Array.isArray(target)
    ? (target.filter(Boolean) as string[])
    : typeof target === 'string'
      ? [target]
      : [];
  return targets.some((t) => t === 'async-node' || t.startsWith('node'));
};

/**
 * Default `testEnvironment` derived from a build target: Node targets map to
 * `'node'`, everything else (including no target) to `'happy-dom'`. Shared by
 * the rsbuild and rspack adapters; rslib keeps its own inverse rule (see its
 * call site) because libraries are Node-first, so an absent target → `'node'`.
 */
export const resolveTestEnvironmentFromTarget = (
  target: AdapterBuildTarget,
): 'node' | 'happy-dom' => (isNodeTarget(target) ? 'node' : 'happy-dom');
