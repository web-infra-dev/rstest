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

  it('uses the default screenshot directory and filename layout', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'renders a component' });

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

  it('keeps sanitized screenshot names distinct', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'renders a b' });
      await match(root, { testName: 'renders-a-b' });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const filenames = await fs.readdir(screenshotDirectory);
      expect(filenames).toHaveLength(2);
      expect(new Set(filenames).size).toBe(2);
      expect(filenames).toContain('renders-a-b-chromium-linux.png');
      expect(
        filenames.some((name) => /renders-a-b~[a-f0-9]{64}/.test(name)),
      ).toBe(true);
    });
  });

  it('keeps case-only screenshot names distinct', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'Header' });
      await match(root, { testName: 'header' });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const filenames = await fs.readdir(screenshotDirectory);
      expect(filenames).toHaveLength(2);
      expect(filenames).toContain('header-chromium-linux.png');
      expect(filenames.some((name) => /Header~[a-f0-9]{64}/.test(name))).toBe(
        true,
      );
    });
  });

  it('keeps names distinct when path normalization changes the input', async () => {
    await withRoot(async (root) => {
      for (const testName of ['header', './header', 'a/../header']) {
        await match(root, { testName });
      }

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const filenames = await fs.readdir(screenshotDirectory);
      expect(filenames).toHaveLength(3);
      expect(filenames).toContain('header-chromium-linux.png');
    });
  });

  it('preserves test source directories under a shared screenshot root', async () => {
    await withRoot(async (root) => {
      const screenshotDirectory = path.join(root, 'references');
      for (const sourceDirectory of ['a', 'b']) {
        await match(root, {
          rootPath: root,
          testPath: path.join(
            root,
            'tests',
            sourceDirectory,
            'example.test.ts',
          ),
          screenshotDirectory,
          testName: 'same name',
        });
      }

      const projectDirectories = await fs.readdir(
        path.join(screenshotDirectory, '__projects__'),
      );
      expect(projectDirectories).toHaveLength(1);

      for (const sourceDirectory of ['a', 'b']) {
        expect(
          await fs.readdir(
            path.join(
              screenshotDirectory,
              '__projects__',
              projectDirectories[0]!,
              'tests',
              sourceDirectory,
              'example.test.ts',
            ),
          ),
        ).toEqual(['same-name-chromium-linux.png']);
      }
    });
  });

  it('preserves test source directories when a relative directory is shared', async () => {
    await withRoot(async (root) => {
      for (const sourceDirectory of ['a', 'b']) {
        await match(root, {
          rootPath: root,
          testPath: path.join(
            root,
            'tests',
            sourceDirectory,
            'example.test.ts',
          ),
          screenshotDirectory: '../references',
          testName: 'same name',
        });
      }

      const referenceRoot = path.join(root, 'tests', 'references');
      const projectDirectories = await fs.readdir(
        path.join(referenceRoot, '__projects__'),
      );
      expect(projectDirectories).toHaveLength(1);

      for (const sourceDirectory of ['a', 'b']) {
        expect(
          await fs.readdir(
            path.join(
              referenceRoot,
              '__projects__',
              projectDirectories[0]!,
              'tests',
              sourceDirectory,
              'example.test.ts',
            ),
          ),
        ).toEqual(['same-name-chromium-linux.png']);
      }
    });
  });

  it('keeps different project roots distinct in one shared screenshot directory', async () => {
    await withRoot(async (root) => {
      const screenshotDirectory = path.join(root, 'references');
      for (const project of ['a', 'b']) {
        const projectRoot = path.join(root, project);
        await match(root, {
          rootPath: projectRoot,
          projectName: project,
          testPath: path.join(projectRoot, 'tests', 'example.test.ts'),
          screenshotDirectory,
          testName: 'same name',
        });
      }

      const projectDirectories = await fs.readdir(
        path.join(screenshotDirectory, '__projects__'),
      );
      expect(projectDirectories).toHaveLength(2);
      for (const projectDirectory of projectDirectories) {
        expect(
          await fs.readdir(
            path.join(
              screenshotDirectory,
              '__projects__',
              projectDirectory,
              'tests',
              'example.test.ts',
            ),
          ),
        ).toEqual(['same-name-chromium-linux.png']);
      }
    });
  });

  it('keeps shared screenshot paths stable when a checkout moves', async () => {
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
      const referenceDirectories: string[] = [];
      for (const checkout of ['alice', 'ci']) {
        const projectRoot = path.join(root, checkout, 'repo');
        const screenshotDirectory = path.join(projectRoot, 'references');
        referenceDirectories.push(screenshotDirectory);
        await match(root, {
          snapshotStore: trackingStore,
          rootPath: projectRoot,
          projectName: 'app',
          testPath: path.join(projectRoot, 'tests', 'example.test.ts'),
          screenshotDirectory,
          testName: 'same name',
        });
      }

      expect(savedPaths).toHaveLength(2);
      expect(path.relative(referenceDirectories[0]!, savedPaths[0]!)).toBe(
        path.relative(referenceDirectories[1]!, savedPaths[1]!),
      );
    });
  });

  it('keeps external test paths stable when the checkout moves', async () => {
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
      const referenceDirectories: string[] = [];
      for (const checkout of ['alice', 'ci']) {
        const checkoutRoot = path.join(root, checkout);
        const projectRoot = path.join(checkoutRoot, 'repo');
        const screenshotDirectory = path.join(projectRoot, 'references');
        referenceDirectories.push(screenshotDirectory);
        await match(root, {
          snapshotStore: trackingStore,
          rootPath: projectRoot,
          projectName: 'app',
          testPath: path.join(checkoutRoot, 'external', 'example.test.ts'),
          screenshotDirectory,
          testName: 'same name',
        });
      }

      expect(savedPaths).toHaveLength(2);
      expect(path.relative(referenceDirectories[0]!, savedPaths[0]!)).toBe(
        path.relative(referenceDirectories[1]!, savedPaths[1]!),
      );
    });
  });

  it('does not use the test file as a screenshot directory', async () => {
    await withRoot(async (root) => {
      const testPath = path.join(root, 'tests', 'example.test.ts');
      await fs.writeFile(testPath, '');
      await match(root, {
        rootPath: root,
        testPath,
        screenshotDirectory: '.',
      });
      await match(root, {
        rootPath: root,
        testPath,
        screenshotDirectory: root,
      });

      expect(await fs.readFile(testPath, 'utf8')).toBe('');
      expect(
        await fs.readdir(
          path.join(root, 'tests', '__screenshots__', 'example.test.ts'),
        ),
      ).toEqual(['renders-a-component-chromium-linux.png']);
      expect((await fs.readdir(path.join(root, '__projects__'))).length).toBe(
        1,
      );
    });
  });

  it('keeps the first unnamed assertion ordinal absent for a custom resolver', async () => {
    await withRoot(async (root) => {
      const ordinals: (number | undefined)[] = [];
      const resolvePath: NonNullable<
        Parameters<typeof matchBrowserScreenshot>[0]['resolvePath']
      > = (options) => {
        ordinals.push(options.screenshotAssertionOrdinal);
        return path.join(root, `reference-${ordinals.length}.png`);
      };
      await match(root, { resolvePath, screenshotAssertionOrdinal: 1 });
      await match(root, { resolvePath, screenshotAssertionOrdinal: 2 });
      expect(ordinals).toEqual([undefined, 2]);
    });
  });

  it('disambiguates Windows reserved device names in path segments', async () => {
    await withRoot(async (root) => {
      for (const testName of ['con/header', 'AUX/icon', 'lpt1/view']) {
        await match(root, { testName });
      }

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const directories = await fs.readdir(screenshotDirectory);
      expect(directories).toHaveLength(3);
      expect(directories).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^con~[a-f0-9]{64}$/),
          expect.stringMatching(/^AUX~[a-f0-9]{64}$/),
          expect.stringMatching(/^lpt1~[a-f0-9]{64}$/),
        ]),
      );
    });
  });

  it('keeps generated screenshot filenames below the filesystem limit', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'a'.repeat(300) });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const [filename] = await fs.readdir(screenshotDirectory);
      expect(Buffer.byteLength(filename!)).toBeLessThanOrEqual(240);
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
      await match(root, {
        testName: 'renders a component',
        screenshotAssertionOrdinal: 1,
      });
      await match(root, {
        testName: 'renders a component',
        screenshotAssertionOrdinal: 2,
      });

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

  it('keeps numbered names distinct from repeated assertion ordinals', async () => {
    await withRoot(async (root) => {
      await match(root, {
        testName: 'foo',
        screenshotAssertionOrdinal: 1,
      });
      await match(root, { testName: 'foo 1' });

      const screenshotDirectory = path.join(
        root,
        'tests',
        '__screenshots__',
        'example.test.ts',
      );
      const filenames = await fs.readdir(screenshotDirectory);
      expect(filenames).toHaveLength(2);
      expect(filenames).toContain('foo-1-chromium-linux.png');
      expect(
        filenames.some((name) =>
          /^foo-1~[a-f0-9]{64}-chromium-linux\.png$/.test(name),
        ),
      ).toBe(true);
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
