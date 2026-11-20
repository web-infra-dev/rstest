import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import {
  findReusableEntry,
  getBundlePath,
  isEntryValid,
  MAX_ENTRIES_PER_KEY,
  MAX_KEYS_PER_ENVIRONMENT,
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

  it('does not write a manifest for a missing input or an input with a later mtime than the build start', async () => {
    await withTempDir('rstest-env-cache-manifest-', async (root) => {
      const input = path.join(root, 'input.js');
      const missing = path.join(root, 'missing.js');
      fs.writeFileSync(input, 'one');
      const stats = fs.statSync(input);
      const write = (files: string[], startedAt: number) =>
        writeManifest({
          bundleSize: 0,
          directory: root,
          externals: [],
          files,
          missing: [],
          startedAt,
        });

      expect(await write([input, missing], Date.now())).toBe(missing);
      expect(fs.existsSync(path.join(root, 'manifest.json'))).toBe(false);

      expect(await write([input], Math.floor(stats.mtimeMs) - 1)).toBe(input);
      expect(fs.existsSync(path.join(root, 'manifest.json'))).toBe(false);

      // Written within the build's first millisecond: not later.
      expect(await write([input], Math.floor(stats.mtimeMs))).toBeUndefined();
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

  it('retries publishEntry on transient rename locks and recreates a concurrently pruned key directory', async () => {
    await withTempDir('rstest-env-cache-publish-retry-', async (root) => {
      const keyDirectory = path.join(root, 'jsdom-key');
      const built = path.join(root, 'build');
      createEntry(built);

      let attempts = 0;
      const published = await publishEntry(built, keyDirectory, {
        retryDelaysMs: [0, 0, 0],
        renameDir: async (from, to) => {
          attempts++;
          if (attempts === 1) {
            throw Object.assign(new Error('locked'), { code: 'EPERM' });
          }
          if (attempts === 2) {
            // Simulate a concurrent prune removing the empty key directory.
            fs.rmdirSync(keyDirectory);
            throw Object.assign(new Error('missing parent'), {
              code: 'ENOENT',
            });
          }
          fs.renameSync(from, to);
        },
      });

      expect(attempts).toBe(3);
      expect(await isEntryValid(published, noExternal)).toBe(true);
    });
  });

  it('does not retry publishEntry when the source build directory is missing', async () => {
    await withTempDir('rstest-env-cache-publish-missing-', async (root) => {
      const keyDirectory = path.join(root, 'jsdom-key');
      const missing = path.join(root, 'absent');
      let attempts = 0;

      await expect(
        publishEntry(missing, keyDirectory, {
          retryDelaysMs: [0, 0, 0],
          renameDir: async () => {
            attempts++;
            throw Object.assign(new Error('missing source'), {
              code: 'ENOENT',
            });
          },
        }),
      ).rejects.toThrow('missing source');
      expect(attempts).toBe(1);
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
  it('keeps old entries within the per-environment key cap and removes empty keys and stale build directories', async () => {
    await withTempDir('rstest-env-cache-prune-', async (root) => {
      const base = path.join(root, 'cache');
      const entry = (key: string, name: string) => path.join(base, key, name);

      // Even entries idle for 30 days are kept when within the key budget.
      createEntry(entry('jsdom-key1', 'old-valid'));
      setLastUsed(entry('jsdom-key1', 'old-valid'), 30 * DAY);
      // Empty key directory is removed.
      fs.mkdirSync(path.join(base, 'jsdom-empty'), { recursive: true });
      fs.mkdirSync(path.join(base, '.tmp-crashed'));
      setLastUsed(path.join(base, '.tmp-crashed'), 2 * HOUR);
      fs.mkdirSync(path.join(base, '.tmp-building'));

      await pruneCache(base);

      expect(fs.readdirSync(path.join(base, 'jsdom-key1'))).toEqual([
        'old-valid',
      ]);
      expect(fs.existsSync(path.join(base, 'jsdom-empty'))).toBe(false);
      expect(
        fs.readdirSync(base).filter((name) => name.startsWith('.')),
      ).toEqual(['.tmp-building']);
    });
  });

  it('deduplicates surplus entries within one key only after the idle grace', async () => {
    await withTempDir('rstest-env-cache-limit-', async (root) => {
      const key = path.join(root, 'cache', 'jsdom-key');
      const names = Array.from(
        { length: MAX_ENTRIES_PER_KEY + 2 },
        (_, i) => `entry-${i}`,
      );
      // Processes that cold-start together each publish a just-used entry.
      for (const name of names) {
        createEntry(path.join(key, name));
        await touchEntry(path.join(key, name));
      }

      await pruneCache(path.join(root, 'cache'));
      expect(fs.readdirSync(key).sort()).toEqual(names);

      // Once surplus copies have been idle for over an hour, only MAX_ENTRIES_PER_KEY remain.
      for (const name of names.slice(MAX_ENTRIES_PER_KEY)) {
        setLastUsed(path.join(key, name), 2 * HOUR);
      }
      await pruneCache(path.join(root, 'cache'));
      expect(fs.readdirSync(key).sort()).toEqual(
        names.slice(0, MAX_ENTRIES_PER_KEY),
      );
    });
  });

  it('caps keys per environment independently without evicting active keys or other environments', async () => {
    await withTempDir('rstest-env-cache-env-cap-', async (root) => {
      const base = path.join(root, 'cache');
      const entry = (key: string, name: string) => path.join(base, key, name);

      // Publish MAX_KEYS_PER_ENVIRONMENT + 1 jsdom keys (including extra copies
      // under the newest key to ensure duplicate entries do not consume other
      // keys' budget) plus a hyphenated happy-dom key that is much older.
      for (let i = 0; i <= MAX_KEYS_PER_ENVIRONMENT; i++) {
        const keyName = `jsdom-key${i}`;
        createEntry(entry(keyName, 'main'));
        setLastUsed(entry(keyName, 'main'), (i + 2) * HOUR);
      }
      createEntry(entry('jsdom-key0', 'concurrent-copy'));
      setLastUsed(entry('jsdom-key0', 'concurrent-copy'), 3 * HOUR);

      // Hyphenated environment name gets its own independent key budget.
      createEntry(entry('happy-dom-key0', 'main'));
      setLastUsed(entry('happy-dom-key0', 'main'), 30 * DAY);

      await pruneCache(base);

      // Oldest jsdom key beyond MAX_KEYS_PER_ENVIRONMENT is removed.
      expect(
        fs.existsSync(path.join(base, `jsdom-key${MAX_KEYS_PER_ENVIRONMENT}`)),
      ).toBe(false);
      // The newest MAX_KEYS_PER_ENVIRONMENT jsdom keys stay, and key0 was deduplicated.
      for (let i = 0; i < MAX_KEYS_PER_ENVIRONMENT; i++) {
        expect(fs.existsSync(path.join(base, `jsdom-key${i}`))).toBe(true);
      }
      expect(fs.readdirSync(path.join(base, 'jsdom-key0'))).toEqual(['main']);
      // happy-dom key was unaffected by jsdom publications.
      expect(fs.existsSync(path.join(base, 'happy-dom-key0'))).toBe(true);
    });
  });

  it('keeps an overflow key whose entry is still within the idle grace', async () => {
    await withTempDir('rstest-env-cache-env-grace-', async (root) => {
      const base = path.join(root, 'cache');
      for (let i = 0; i <= MAX_KEYS_PER_ENVIRONMENT; i++) {
        const dir = path.join(base, `happy-dom-key${i}`, 'main');
        createEntry(dir);
        setLastUsed(dir, i * 1000);
      }

      await pruneCache(base);
      for (let i = 0; i <= MAX_KEYS_PER_ENVIRONMENT; i++) {
        expect(fs.existsSync(path.join(base, `happy-dom-key${i}`))).toBe(true);
      }
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
