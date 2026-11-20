import { createHash, randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * On-disk cache of DOM test-environment bundles. Layout under `<cacheBase>`,
 * inside `node_modules/.cache/.rstest-test-environments` so the bundled
 * third-party code keeps a `node_modules` path segment without colliding with
 * Rspack's `rstest-*` build cache directories:
 *
 *   <env>-<key>/<entry>/dist/environment.mjs   the bundle
 *   <env>-<key>/<entry>/manifest.json          the inputs it was built from
 *   .tmp-*                                     builds in progress
 *
 * `<env>-<key>` hashes everything known before building. `<entry>` is a random
 * name, so concurrent publishers never collide and nothing is replaced in
 * place. An entry is reused only while every input in its manifest is
 * unchanged.
 */

export const MAX_ENTRIES_PER_KEY = 1;
export const MAX_KEYS_PER_ENVIRONMENT = 3;
// How long a build directory or a surplus entry must sit idle before pruning.
const IDLE_GRACE_MS = 60 * 60 * 1000;
const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_FORMAT = 1;
// Windows antivirus/indexers can briefly lock freshly written directories during
// rename, and a concurrent prune can remove an empty key directory between
// `mkdir` and `rename`.
const PUBLISH_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'ENOENT', 'EPERM']);
const PUBLISH_RETRY_DELAYS_MS = [20, 40, 80, 160];

export type ExternalResolution = {
  context: string;
  request: string;
  /** `null` when the request did not resolve. */
  resolved: string | null;
};

type PrebundleManifest = {
  format: number;
  bundleSize: number;
  /** `[path, size, mtimeMs]` of every file the compilation read. */
  files: [string, number, number][];
  /** Paths the resolver probed and did not find. */
  missing: string[];
  externals: ExternalResolution[];
};

type ResolveExternal = (request: string, context: string) => string | undefined;

export const getBundlePath = (directory: string): string =>
  join(directory, 'dist', 'environment.mjs');

export const hashParts = (parts: unknown): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);

const getErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : undefined;

// Any failure (missing path, ENOTDIR, EACCES) means "not usable as an input".
const statIfExists = (path: string) => {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
};

/**
 * Stamp what the compilation read and write `manifest.json` next to the
 * bundle. Returns the path of an input that makes the stamp unreliable, in
 * which case nothing is written: an input that disappeared before stamping or
 * whose mtime is later than the build start (modified during the build or a
 * future mtime) could leave the manifest out of sync with the built bundle.
 */
export const writeManifest = async ({
  bundleSize,
  directory,
  externals,
  files,
  missing,
  startedAt,
}: {
  bundleSize: number;
  directory: string;
  externals: ExternalResolution[];
  files: Iterable<string>;
  missing: Iterable<string>;
  startedAt: number;
}): Promise<string | undefined> => {
  const stamped: PrebundleManifest['files'] = [];
  for (const path of [...new Set(files)].sort()) {
    const stats = statIfExists(path);
    if (!stats) {
      return path;
    }
    if (!stats.isFile()) {
      continue;
    }
    // `startedAt` is whole milliseconds and `mtimeMs` is fractional, so a
    // file written within the same millisecond must not count as later.
    if (Math.floor(stats.mtimeMs) > startedAt) {
      return path;
    }
    stamped.push([path, stats.size, stats.mtimeMs]);
  }
  const manifest: PrebundleManifest = {
    format: MANIFEST_FORMAT,
    bundleSize,
    files: stamped,
    missing: [...new Set(missing)].sort(),
    externals,
  };
  await writeFile(join(directory, MANIFEST_FILE), JSON.stringify(manifest));
  return undefined;
};

const isManifest = (value: unknown): value is PrebundleManifest =>
  typeof value === 'object' &&
  value !== null &&
  'format' in value &&
  value.format === MANIFEST_FORMAT &&
  'bundleSize' in value &&
  typeof value.bundleSize === 'number' &&
  'files' in value &&
  Array.isArray(value.files) &&
  'missing' in value &&
  Array.isArray(value.missing) &&
  'externals' in value &&
  Array.isArray(value.externals);

/** Whether `directory` holds a complete bundle whose inputs are unchanged. */
export const isEntryValid = async (
  directory: string,
  resolveExternal: ResolveExternal,
): Promise<boolean> => {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(join(directory, MANIFEST_FILE), 'utf8'),
    );
    if (
      !isManifest(manifest) ||
      statIfExists(getBundlePath(directory))?.size !== manifest.bundleSize
    ) {
      return false;
    }
    // Synchronous on purpose: a jsdom manifest lists about 1.3k files and 2.2k
    // probed paths. The calls take ~8 ms back to back, but 30-50 ms when queued
    // on the libuv thread pool behind the build that runs concurrently.
    return (
      manifest.files.every(([path, size, mtimeMs]) => {
        const stats = statIfExists(path);
        return stats?.size === size && stats.mtimeMs === mtimeMs;
      }) &&
      manifest.missing.every((path) => statIfExists(path) === undefined) &&
      manifest.externals.every(
        ({ context, request, resolved }) =>
          (resolveExternal(request, context) ?? null) === resolved,
      )
    );
  } catch {
    return false;
  }
};

/**
 * Record `directory` as just used. Failure is ignored so that a read-only,
 * pre-warmed `node_modules` still hits.
 */
export const touchEntry = async (directory: string): Promise<void> => {
  const now = new Date();
  await utimes(directory, now, now).catch(() => {});
};

const byLastUsed = (parent: string, names: string[]) =>
  names
    .map((name) => {
      const path = join(parent, name);
      return { path, lastUsed: statIfExists(path)?.mtimeMs ?? 0 };
    })
    .sort((a, b) => b.lastUsed - a.lastUsed);

// Key directories are named `<env>-<hash>`, where `<env>` itself may contain a
// hyphen (e.g. `happy-dom`). Split on the last hyphen so each environment gets
// its own key budget.
const getEnvironmentGroup = (keyName: string): string => {
  const separator = keyName.lastIndexOf('-');
  return separator > 0 ? keyName.slice(0, separator) : keyName;
};

/** The most recently used valid entry of `keyDirectory`, marked as used. */
export const findReusableEntry = async (
  keyDirectory: string,
  resolveExternal: ResolveExternal,
): Promise<string | undefined> => {
  const names = await readdir(keyDirectory).catch(() => []);
  for (const { path } of byLastUsed(keyDirectory, names)) {
    if (await isEntryValid(path, resolveExternal)) {
      await touchEntry(path);
      return path;
    }
  }
  return undefined;
};

/**
 * Move a finished build into the cache with a single `rename`, so no reader
 * sees a partial entry. The name is unique: when two processes publish the
 * same inputs both entries stay, and pruning removes the surplus.
 */
export const publishEntry = async (
  builtDirectory: string,
  keyDirectory: string,
  {
    renameDir = rename,
    retryDelaysMs = PUBLISH_RETRY_DELAYS_MS,
  }: {
    renameDir?: (oldPath: string, newPath: string) => Promise<void>;
    retryDelaysMs?: readonly number[];
  } = {},
): Promise<string> => {
  const directory = join(keyDirectory, randomBytes(6).toString('hex'));
  for (let attempt = 0; ; attempt++) {
    await mkdir(keyDirectory, { recursive: true });
    try {
      await renameDir(builtDirectory, directory);
      return directory;
    } catch (error) {
      const code = getErrorCode(error);
      const delayMs = retryDelaysMs[attempt];
      if (
        delayMs === undefined ||
        !code ||
        !PUBLISH_RETRY_CODES.has(code) ||
        (code === 'ENOENT' && !statIfExists(builtDirectory))
      ) {
        throw error;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
};

/**
 * Best-effort cleanup, run after a publish. Uses count-based LRU instead of a
 * time TTL so valid entries are not evicted merely because they sat unused:
 *
 * - `.tmp-*` build directories idle for over an hour are removed.
 * - Within each key, surplus entries beyond `MAX_ENTRIES_PER_KEY` (concurrent
 *   publishers or rebuilt manifests) are removed once idle for over an hour.
 * - Per environment (`jsdom`, `happy-dom`), keys beyond the
 *   `MAX_KEYS_PER_ENVIRONMENT` most recently used have their idle entries (>1h)
 *   removed, and empty key directories are cleaned up.
 */
export const pruneCache = async (
  cacheBase: string,
  now: number = Date.now(),
): Promise<void> => {
  const remove = (path: string) =>
    rm(path, { recursive: true, force: true }).catch(() => {});
  const keysByEnvironment = new Map<
    string,
    {
      path: string;
      lastUsed: number;
      entries: { path: string; lastUsed: number }[];
    }[]
  >();

  for (const name of await readdir(cacheBase).catch(() => [])) {
    const path = join(cacheBase, name);
    if (name.startsWith('.')) {
      const stats = statIfExists(path);
      if (stats && now - stats.mtimeMs > IDLE_GRACE_MS) {
        await remove(path);
      }
      continue;
    }

    const entries = byLastUsed(path, await readdir(path).catch(() => []));
    if (entries.length === 0) {
      await rmdir(path).catch(() => {});
      continue;
    }

    const remaining: { path: string; lastUsed: number }[] = [];
    for (const [index, entry] of entries.entries()) {
      // Keep concurrent cold-start copies until they have been idle for a while.
      if (
        index >= MAX_ENTRIES_PER_KEY &&
        now - entry.lastUsed > IDLE_GRACE_MS
      ) {
        await remove(entry.path);
      } else {
        remaining.push(entry);
      }
    }

    if (remaining.length === 0) {
      await rmdir(path).catch(() => {});
      continue;
    }

    const group = getEnvironmentGroup(name);
    const groupKeys = keysByEnvironment.get(group) ?? [];
    groupKeys.push({
      path,
      lastUsed: remaining[0]!.lastUsed,
      entries: remaining,
    });
    keysByEnvironment.set(group, groupKeys);
  }

  for (const keys of keysByEnvironment.values()) {
    keys.sort((a, b) => b.lastUsed - a.lastUsed);
    for (const key of keys.slice(MAX_KEYS_PER_ENVIRONMENT)) {
      for (const entry of key.entries) {
        if (now - entry.lastUsed > IDLE_GRACE_MS) {
          await remove(entry.path);
        }
      }
      // Fails while entries within the idle grace remain, which is intended.
      await rmdir(key.path).catch(() => {});
    }
  }
};
