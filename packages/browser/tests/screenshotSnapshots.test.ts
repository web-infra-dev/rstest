import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { PNG } from 'pngjs';
import {
  matchBrowserScreenshot,
  type ScreenshotSnapshotStore,
} from '../src/screenshotSnapshots';

describe('matchBrowserScreenshot', () => {
  const createScreenshot = (
    color: [number, number, number, number] = [20, 80, 180, 255],
  ): string => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set(color);
    return PNG.sync.write(png).toString('base64');
  };

  const snapshotStore: ScreenshotSnapshotStore = {
    async read(filepath) {
      try {
        return (await fs.readFile(filepath)).toString('base64');
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return null;
        }
        throw error;
      }
    },
    async save(filepath, contentBase64) {
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, Buffer.from(contentBase64, 'base64'));
    },
    async remove(filepath) {
      await fs.rm(filepath, { force: true });
    },
  };

  const match = (
    root: string,
    overrides: Partial<Parameters<typeof matchBrowserScreenshot>[0]> = {},
  ) =>
    matchBrowserScreenshot({
      snapshotStore,
      testPath: path.join(root, 'tests', 'example.test.ts'),
      projectName: 'default',
      testName: 'renders a component',
      browserName: 'chromium',
      platform: 'linux',
      screenshotBase64: createScreenshot(),
      updateSnapshot: 'all',
      ...overrides,
    });

  const withRoot = async (callback: (root: string) => Promise<void>) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rstest-screenshot-'));
    try {
      await fs.mkdir(path.join(root, 'tests'), { recursive: true });
      await callback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  };

  it('validates comparison options before creating a baseline', async () => {
    await withRoot(async (root) => {
      await expect(match(root, { options: { threshold: 2 } })).rejects.toThrow(
        'threshold must be between 0 and 1',
      );
      await expect(
        fs.access(path.join(root, 'tests', '__screenshots__')),
      ).rejects.toThrow();
    });
  });

  it('reports whether a screenshot was added, updated, or matched', async () => {
    await withRoot(async (root) => {
      expect(await match(root, { updateSnapshot: 'new' })).toBe('added');
      expect(await match(root, { updateSnapshot: 'none' })).toBe('matched');
      expect(
        await match(root, {
          screenshotBase64: createScreenshot([180, 40, 20, 255]),
          updateSnapshot: 'all',
        }),
      ).toBe('updated');
    });
  });

  it('does not persist a baseline after the screenshot deadline', async () => {
    await withRoot(async (root) => {
      let saved = false;
      const deadline = Date.now() + 30;
      const delayedStore: ScreenshotSnapshotStore = {
        ...snapshotStore,
        async read() {
          return null;
        },
        async save(_filepath, _contentBase64, saveDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (saveDeadline === undefined || Date.now() < saveDeadline) {
            saved = true;
          }
        },
      };

      await expect(
        match(root, { snapshotStore: delayedStore, deadline }),
      ).rejects.toThrow(
        'Screenshot assertion exceeded the active test timeout',
      );
      expect(saved).toBe(false);
    });
  });

  it('uses the Vitest screenshot directory and filename layout', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'renders a -- component!' });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      expect(await fs.readdir(screenshotDirectory)).toEqual([
        'renders-a-component-chromium-linux.png',
      ]);
    });
  });

  it('keeps external test paths distinct from similarly named in-root paths', async () => {
    await withRoot(async (root) => {
      const savedPaths: string[] = [];
      const trackingStore: ScreenshotSnapshotStore = {
        ...snapshotStore,
        async read() {
          return null;
        },
        async save(filepath) {
          savedPaths.push(filepath);
        },
      };

      await match(root, {
        snapshotStore: trackingStore,
        rootPath: root,
        testPath: path.join(root, '..', 'foo.test.ts'),
        screenshotDirectory: 'references',
        testName: 'same test',
      });
      await match(root, {
        snapshotStore: trackingStore,
        rootPath: root,
        testPath: path.join(root, '_parent_', 'foo.test.ts'),
        screenshotDirectory: 'references',
        testName: 'same test',
      });

      expect(savedPaths).toHaveLength(2);
      expect(savedPaths[0]).not.toBe(savedPaths[1]);
    });
  });

  it('adds repeated unnamed assertion ordinals to the screenshot name', async () => {
    await withRoot(async (root) => {
      await match(root, { screenshotAssertionOrdinal: 1 });
      await match(root, { screenshotAssertionOrdinal: 2 });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      expect(await fs.readdir(screenshotDirectory)).toEqual([
        'renders-a-component-1-chromium-linux.png',
        'renders-a-component-2-chromium-linux.png',
      ]);
    });
  });

  it('keeps screenshot paths distinct for test files with different extensions', async () => {
    await withRoot(async (root) => {
      await match(root);
      await match(root, {
        testPath: path.join(root, 'tests', 'example.test.tsx'),
      });

      const screenshotRoot = path.join(root, 'tests', '__screenshots__');
      expect(await fs.readdir(screenshotRoot)).toEqual([
        'example.test.ts',
        'example.test.tsx',
      ]);
    });
  });

  it('replaces an invalid PNG reference in update mode', async () => {
    await withRoot(async (root) => {
      await match(root);

      const screenshotDir = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const [referenceName] = await fs.readdir(screenshotDir);
      const referencePath = path.join(screenshotDir, referenceName!);
      await fs.writeFile(referencePath, 'not a PNG');

      await match(root, { updateSnapshot: 'all' });
      await match(root, { updateSnapshot: 'none' });

      expect((await fs.readFile(referencePath)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    });
  });
});
