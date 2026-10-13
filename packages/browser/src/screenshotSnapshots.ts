import fs from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { basename, dirname, join, parse } from 'pathe';
import { PNG } from 'pngjs';
import type { SnapshotUpdateState } from '@vitest/snapshot';

const sanitizeScreenshotName = (name: string): string => {
  const sanitized = name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return sanitized || 'screenshot';
};

const resolveScreenshotPath = (
  testPath: string,
  testName: string,
  browserName: string,
): string =>
  join(
    dirname(testPath),
    '__screenshots__',
    parse(basename(testPath)).name,
    `${sanitizeScreenshotName(testName)}-${browserName}-${process.platform}.png`,
  );

const writeScreenshot = async (
  filepath: string,
  screenshot: Buffer,
): Promise<void> => {
  await fs.mkdir(dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, screenshot);
};

export const matchBrowserScreenshot = async ({
  testPath,
  testName,
  browserName,
  screenshotBase64,
  updateSnapshot,
}: {
  testPath: string;
  testName: string;
  browserName: string;
  screenshotBase64: string;
  updateSnapshot: SnapshotUpdateState;
}): Promise<void> => {
  const filepath = resolveScreenshotPath(testPath, testName, browserName);
  const actualBuffer = Buffer.from(screenshotBase64, 'base64');
  let expectedBuffer: Buffer | undefined;

  try {
    expectedBuffer = await fs.readFile(filepath);
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw error;
    }
  }

  if (!expectedBuffer) {
    if (updateSnapshot === 'new' || updateSnapshot === 'all') {
      await writeScreenshot(filepath, actualBuffer);
      return;
    }
    throw new Error(
      `No screenshot reference found for "${testName}". Run Rstest with --update to create it.\nReference: ${filepath}`,
    );
  }

  if (updateSnapshot === 'all') {
    await writeScreenshot(filepath, actualBuffer);
    return;
  }

  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualBuffer);

  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Screenshot dimensions differ for "${testName}": expected ${expected.width}x${expected.height}, received ${actual.width}x${actual.height}.\nReference: ${filepath}`,
    );
  }

  const differentPixels = pixelmatch(
    expected.data,
    actual.data,
    null,
    expected.width,
    expected.height,
    { threshold: 0.1 },
  );

  if (differentPixels > 0) {
    throw new Error(
      `Screenshot does not match the stored reference for "${testName}": ${differentPixels} pixels differ.\nReference: ${filepath}\nRun Rstest with --update to replace it.`,
    );
  }
};
