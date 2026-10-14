import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { PNG } from 'pngjs';
import { matchBrowserScreenshot } from '../src/screenshotSnapshots';

describe('matchBrowserScreenshot', () => {
  const createScreenshot = (): string => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([20, 80, 180, 255]);
    return PNG.sync.write(png).toString('base64');
  };

  const match = (
    root: string,
    overrides: Partial<Parameters<typeof matchBrowserScreenshot>[0]> = {},
  ) =>
    matchBrowserScreenshot({
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

  it('keeps sanitized test names unique and project names inside the screenshot directory', async () => {
    await withRoot(async (root) => {
      await match(root, { testName: 'renders a b' });
      await match(root, { testName: 'renders a-b' });
      await match(root, { projectName: '..', testName: 'renders safely' });

      const screenshotRoot = path.join(root, 'tests', '__screenshots__');
      const projectDir = path.join(screenshotRoot, 'default');
      const [testDirectory] = await fs.readdir(projectDir);
      const files = await fs.readdir(path.join(projectDir, testDirectory!));
      expect(files).toHaveLength(2);
      expect(
        await fs.readdir(
          path.join(screenshotRoot, '%2E%2E', 'example.test.ts'),
        ),
      ).toHaveLength(1);
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
        'default',
        'example.test.ts',
      );
      const [referenceName] = await fs.readdir(screenshotDir);
      expect(Buffer.byteLength(referenceName!)).toBeLessThanOrEqual(255);
    });
  });

  it('keeps screenshot paths distinct for test files with different extensions', async () => {
    await withRoot(async (root) => {
      await match(root);
      await match(root, {
        testPath: path.join(root, 'tests', 'example.test.tsx'),
      });

      const projectDir = path.join(root, 'tests', '__screenshots__', 'default');
      expect(await fs.readdir(projectDir)).toEqual([
        'example.test.ts',
        'example.test.tsx',
      ]);
    });
  });

  it('replaces an invalid PNG reference in update mode', async () => {
    await withRoot(async (root) => {
      await match(root);

      const projectDir = path.join(root, 'tests', '__screenshots__', 'default');
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
