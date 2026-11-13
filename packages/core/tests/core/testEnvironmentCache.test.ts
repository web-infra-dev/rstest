import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  CACHE_ENTRY_TTL_MS,
  findReusableEntry,
  getBundlePath,
  isEntryValid,
  MAX_ENTRIES_PER_KEY,
  pruneCache,
  publishEntry,
  touchEntry,
  writeManifest,
} from '../../src/core/environment/testEnvironmentCache';
import { withTempDir } from '../helpers/tempDir';

const noExternal = () => undefined;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const createEntry = (
  directory: string,
  { input }: { input?: string } = {},
): void => {
  fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
  fs.writeFileSync(getBundlePath(directory), 'export {};');
  const files: [string, number, number][] = [];
  if (input) {
    const stats = fs.statSync(input);
    files.push([input, stats.size, stats.mtimeMs]);
  }
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      format: 1,
      bundleSize: fs.statSync(getBundlePath(directory)).size,
      files,
      missing: [],
      externals: [],
    }),
  );
};

const setLastUsed = (directory: string, msAgo: number): void => {
  const time = new Date(Date.now() - msAgo);
  fs.utimesSync(directory, time, time);
};

describe('prebundle cache entries', () => {
  it('rejects an entry whose recorded input is missing or whose probed path now exists', async () => {
    await withTempDir('rstest-env-cache-entry-', async (root) => {
      const input = path.join(root, 'input.js');
      fs.writeFileSync(input, 'one');
      const entry = path.join(root, 'entry');
      createEntry(entry, { input });
      expect(await isEntryValid(entry, noExternal)).toBe(true);

      fs.rmSync(input);
      expect(await isEntryValid(entry, noExternal)).toBe(false);

      const probed = path.join(root, 'probed.js');
      const manifestPath = path.join(entry, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, files: [], missing: [probed] }),
      );
      expect(await isEntryValid(entry, noExternal)).toBe(true);
      fs.writeFileSync(probed, '');
      expect(await isEntryValid(entry, noExternal)).toBe(false);
    });
  });

  it('does not write a manifest for an input with a later mtime than the build start', async () => {
    await withTempDir('rstest-env-cache-manifest-', async (root) => {
      const input = path.join(root, 'input.js');
      fs.writeFileSync(input, 'one');
      const stats = fs.statSync(input);
      const write = (startedAt: number) =>
        writeManifest({
          bundleSize: 0,
          directory: root,
          externals: [],
          files: [input],
          missing: [],
          startedAt,
        });

      expect(await write(Math.floor(stats.mtimeMs) - 1)).toBe(input);
      expect(fs.existsSync(path.join(root, 'manifest.json'))).toBe(false);
      // Written within the build's first millisecond: not later.
      expect(await write(Math.floor(stats.mtimeMs))).toBeUndefined();
      expect(fs.existsSync(path.join(root, 'manifest.json'))).toBe(true);
    });
  });

  it('publishes each build under its own name', async () => {
    await withTempDir('rstest-env-cache-publish-', async (root) => {
      const keyDirectory = path.join(root, 'key');
      const first = path.join(root, 'build-a');
      const second = path.join(root, 'build-b');
      createEntry(first);
      createEntry(second);

      const a = await publishEntry(first, keyDirectory);
      const b = await publishEntry(second, keyDirectory);

      expect(a).not.toBe(b);
      expect(fs.readdirSync(keyDirectory)).toHaveLength(2);
      expect(fs.existsSync(first)).toBe(false);
      expect(await isEntryValid(a, noExternal)).toBe(true);
    });
  });

  it('reuses the most recently used valid entry and marks it used', async () => {
    await withTempDir('rstest-env-cache-find-', async (root) => {
      const keyDirectory = path.join(root, 'key');
      createEntry(path.join(keyDirectory, 'older'));
      createEntry(path.join(keyDirectory, 'newer'));
      createEntry(path.join(keyDirectory, 'damaged'));
      fs.rmSync(getBundlePath(path.join(keyDirectory, 'damaged')));
      setLastUsed(path.join(keyDirectory, 'older'), 2 * DAY);
      setLastUsed(path.join(keyDirectory, 'newer'), DAY);
      setLastUsed(path.join(keyDirectory, 'damaged'), 0);

      const found = await findReusableEntry(keyDirectory, noExternal);

      expect(found).toBe(path.join(keyDirectory, 'newer'));
      expect(Date.now() - fs.statSync(found!).mtimeMs).toBeLessThan(DAY / 2);
    });
  });

  it('ignores a failure to update the last-used time', async () => {
    await withTempDir('rstest-env-cache-touch-', async (root) => {
      const missing = path.join(root, 'missing');
      await expect(touchEntry(missing)).resolves.toBeUndefined();
    });
  });
});

describe('prebundle cache pruning', () => {
  it('removes expired entries, empty keys and stale build directories', async () => {
    await withTempDir('rstest-env-cache-prune-', async (root) => {
      const base = path.join(root, 'cache');
      const entry = (key: string, name: string) => path.join(base, key, name);

      // Within the limit and the TTL: kept.
      createEntry(entry('jsdom-key', 'fresh'));
      // Beyond the TTL: removed.
      createEntry(entry('jsdom-key', 'idle'));
      setLastUsed(entry('jsdom-key', 'idle'), CACHE_ENTRY_TTL_MS + DAY);
      // A key whose entries all expire is removed with them.
      createEntry(entry('gone-key', 'idle'));
      setLastUsed(entry('gone-key', 'idle'), CACHE_ENTRY_TTL_MS + DAY);
      fs.mkdirSync(path.join(base, '.tmp-crashed'));
      setLastUsed(path.join(base, '.tmp-crashed'), 2 * HOUR);
      fs.mkdirSync(path.join(base, '.tmp-building'));

      await pruneCache(base);

      expect(fs.readdirSync(path.join(base, 'jsdom-key'))).toEqual(['fresh']);
      expect(fs.existsSync(path.join(base, 'gone-key'))).toBe(false);
      expect(
        fs.readdirSync(base).filter((name) => name.startsWith('.')),
      ).toEqual(['.tmp-building']);
    });
  });

  it('applies the per-key limit only to entries that are no longer in use', async () => {
    await withTempDir('rstest-env-cache-limit-', async (root) => {
      const key = path.join(root, 'cache', 'jsdom-key');
      const names = Array.from(
        { length: MAX_ENTRIES_PER_KEY + 1 },
        (_, i) => `entry-${i}`,
      );
      // Processes that cold-start together each publish a just-used entry.
      for (const name of names) {
        createEntry(path.join(key, name));
        await touchEntry(path.join(key, name));
      }

      await pruneCache(path.join(root, 'cache'));
      expect(fs.readdirSync(key).sort()).toEqual(names);

      // Once the surplus one has been idle for a while, it alone goes.
      setLastUsed(path.join(key, names.at(-1)!), 2 * HOUR);
      await pruneCache(path.join(root, 'cache'));
      expect(fs.readdirSync(key).sort()).toEqual(names.slice(0, -1));
    });
  });

  it('ignores a cache directory that does not exist', async () => {
    await withTempDir('rstest-env-cache-prune-missing-', async (root) => {
      await expect(
        pruneCache(path.join(root, 'absent')),
      ).resolves.toBeUndefined();
    });
  });
});
