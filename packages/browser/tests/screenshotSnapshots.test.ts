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

  it('keeps sanitized test names unique and project names inside the screenshot directory', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'renders a b' });
      await match(root, { testName: 'renders a-b' });
      await match(root, { projectName: '..', testName: 'renders safely' });

      const screenshotRoot = path.join(root, 'tests', '__screenshots__');
      const projectDirs = await fs.readdir(screenshotRoot);
      expect(projectDirs).toHaveLength(2);
      expect(projectDirs.every((name) => Buffer.byteLength(name) <= 255)).toBe(
        true,
      );
      const projectDir = path.join(
        screenshotRoot,
        projectDirs.find((name) => name.startsWith('default-'))!,
      );
      const [testDirectory] = await fs.readdir(projectDir);
      const files = await fs.readdir(path.join(projectDir, testDirectory!));
      expect(files).toHaveLength(2);
      expect(projectDirs.some((name) => name.startsWith('project-'))).toBe(
        true,
      );
      await expect(fs.access(path.join(root, 'example'))).rejects.toThrow();
    });
  });

  it('limits screenshot filenames by their UTF-8 byte length', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: '按钮'.repeat(80) });

      const screenshotDir = path.join(
        root,
        'tests',
        '__screenshots__',
        (await fs.readdir(path.join(root, 'tests', '__screenshots__')))[0]!,
        'example.test.ts',
      );
      const [referenceName] = await fs.readdir(screenshotDir);
      expect(Buffer.byteLength(referenceName!)).toBeLessThanOrEqual(255);
    });
  });

  it('stores repeated unnamed assertion ordinals as separate path components', async () => {
    await withRoot(async (root) => {
      await match(root);
      await match(root, { screenshotAssertionOrdinal: 2 });

      const screenshotDir = path.join(
        root,
        'tests',
        '__screenshots__',
        (await fs.readdir(path.join(root, 'tests', '__screenshots__')))[0]!,
        'example.test.ts',
      );
      expect(await fs.readdir(screenshotDir)).toEqual(
        expect.arrayContaining([
          'assertion-2',
          expect.stringMatching(/\.png$/),
        ]),
      );
      expect(
        (await fs.readdir(path.join(screenshotDir, 'assertion-2')))[0],
      ).toMatch(/\.png$/);
    });
  });

  it('limits project directory names by their UTF-8 byte length', async () => {
    await withRoot(async (root) => {
      await match(root, { projectName: '项目'.repeat(40) });

      const screenshotRoot = path.join(root, 'tests', '__screenshots__');
      const [projectDirectory] = await fs.readdir(screenshotRoot);
      expect(Buffer.byteLength(projectDirectory!)).toBeLessThanOrEqual(255);
      expect(projectDirectory).toMatch(/-[a-f0-9]{8}$/);
    });
  });

  it('keeps project directory names distinct when they differ by case', async () => {
    await withRoot(async (root) => {
      await match(root, { projectName: 'web' });
      await match(root, { projectName: 'Web' });

      const projectDirs = await fs.readdir(
        path.join(root, 'tests', '__screenshots__'),
      );
      expect(projectDirs).toHaveLength(2);
      expect(projectDirs.map((name) => name.toLowerCase()).sort()[0]).not.toBe(
        projectDirs.map((name) => name.toLowerCase()).sort()[1],
      );
    });
  });

  it('keeps screenshot paths distinct for test files with different extensions', async () => {
    await withRoot(async (root) => {
      await match(root);
      await match(root, {
        testPath: path.join(root, 'tests', 'example.test.tsx'),
      });

      const projectDir = path.join(
        root,
        'tests',
        '__screenshots__',
        (await fs.readdir(path.join(root, 'tests', '__screenshots__')))[0]!,
      );
      expect(await fs.readdir(projectDir)).toEqual([
        'example.test.ts',
        'example.test.tsx',
      ]);
    });
  });

  it('replaces an invalid PNG reference in update mode', async () => {
    await withRoot(async (root) => {
      await match(root);

      const projectDir = path.join(
        root,
        'tests',
        '__screenshots__',
        (await fs.readdir(path.join(root, 'tests', '__screenshots__')))[0]!,
      );
      const [testDirectory] = await fs.readdir(projectDir);
      const screenshotDir = path.join(projectDir, testDirectory!);
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
