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
 * inside `node_modules/.cache` so the bundled third-party code keeps a
 * `node_modules` path segment:
 *
 *   <key>/<entry>/dist/environment.mjs   the bundle
 *   <key>/<entry>/manifest.json          the inputs it was built from
 *   .tmp-*                               builds in progress
 *
 * `<key>` hashes everything known before building. `<entry>` is a random
 * name, so concurrent publishers never collide and nothing is replaced in
 * place. An entry is reused only while every input in its manifest is
 * unchanged.
 */

export const TEST_ENVIRONMENT_CACHE_DIRECTORY = 'rstest-test-environments';
export const CACHE_ENTRY_TTL_MS = 604_800_000;
export const MAX_ENTRIES_PER_KEY = 3;
// How long a build directory or a surplus entry must sit idle before pruning.
const IDLE_GRACE_MS = 60 * 60 * 1000;
const MANIFEST_FILE = 'manifest.json';
const MANIFEST_FORMAT = 1;

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
 * which case nothing is written: a file whose mtime is later than the build
 * start was modified during the build or has a future mtime (clock skew, an
 * extracted archive), so its stamp could describe newer content than the
 * bundle contains.
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
    if (!stats?.isFile()) {
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
): Promise<string> => {
  await mkdir(keyDirectory, { recursive: true });
  const directory = join(keyDirectory, randomBytes(6).toString('hex'));
  await rename(builtDirectory, directory);
  return directory;
};

/**
 * Best-effort cleanup, run after a publish. Removes build directories idle for
 * an hour, entries not used for `CACHE_ENTRY_TTL_MS`, and, per key, entries
 * beyond the `MAX_ENTRIES_PER_KEY` most recently used that have also been idle
 * for an hour. Keys left empty are removed. There is no
 * coordination with running processes: a process holding an entry that went
 * unused for the whole TTL (a watch session that never re-resolved it) can
 * lose it. Watch mode touches its entries on every update to make that
 * unlikely.
 */
export const pruneCache = async (
  cacheBase: string,
  now: number = Date.now(),
): Promise<void> => {
  const remove = (path: string) =>
    rm(path, { recursive: true, force: true }).catch(() => {});
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
    for (const [index, entry] of entries.entries()) {
      const idleFor = now - entry.lastUsed;
      // The per-key limit only applies to entries idle for a while: processes
      // that cold-start together each publish an entry and all of them are in
      // use.
      if (
        idleFor > CACHE_ENTRY_TTL_MS ||
        (index >= MAX_ENTRIES_PER_KEY && idleFor > IDLE_GRACE_MS)
      ) {
        await remove(entry.path);
      }
    }
    // Fails while entries remain, which is the intended outcome.
    await rmdir(path).catch(() => {});
  }
};
