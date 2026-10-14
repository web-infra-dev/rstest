import { createHash } from 'node:crypto';
import pixelmatch from 'pixelmatch';
import { basename, dirname, join, parse } from 'pathe';
import { PNG } from 'pngjs';
import type { SnapshotUpdateState } from '@vitest/snapshot';

export class ScreenshotMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenshotMismatchError';
  }
}

export type ScreenshotMatchOptions = {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
};

const sanitizePathComponent = (name: string, fallback: string): string => {
  const sanitized = name
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '');
  const safeName = sanitized || fallback;
  let prefix = '';
  let prefixBytes = 0;
  for (const character of safeName) {
    const characterBytes = Buffer.byteLength(character);
    if (prefixBytes + characterBytes > 200) break;
    prefix += character;
    prefixBytes += characterBytes;
  }
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
};

const resolveScreenshotPath = (
  testPath: string,
  projectName: string,
  testName: string,
  browserName: string,
): string =>
  join(
    dirname(testPath),
    '__screenshots__',
    sanitizePathComponent(projectName, 'project'),
    basename(testPath),
    `${sanitizePathComponent(testName, 'screenshot')}-${browserName}-${process.platform}.png`,
  );

const getFailurePaths = (referencePath: string) => {
  const referenceName = parse(referencePath).name;
  const failureDir = join(dirname(referencePath), '__failures__');
  return {
    actual: join(failureDir, `${referenceName}.actual.png`),
    diff: join(failureDir, `${referenceName}.diff.png`),
  };
};

const createDimensionDiff = (expected: PNG, actual: PNG): Buffer => {
  const diff = new PNG({
    width: expected.width + actual.width,
    height: Math.max(expected.height, actual.height),
  });
  for (let y = 0; y < expected.height; y++) {
    expected.data.copy(
      diff.data,
      y * diff.width * 4,
      y * expected.width * 4,
      (y + 1) * expected.width * 4,
    );
  }
  for (let y = 0; y < actual.height; y++) {
    actual.data.copy(
      diff.data,
      (y * diff.width + expected.width) * 4,
      y * actual.width * 4,
      (y + 1) * actual.width * 4,
    );
  }
  return PNG.sync.write(diff);
};

export type ScreenshotSnapshotStore = {
  read: (filepath: string) => Promise<string | null>;
  save: (filepath: string, contentBase64: string) => Promise<void>;
  remove: (filepath: string) => Promise<void>;
};

const writeScreenshot = async (
  snapshotStore: ScreenshotSnapshotStore,
  filepath: string,
  screenshot: Buffer,
): Promise<void> => snapshotStore.save(filepath, screenshot.toString('base64'));

const writeFailureArtifacts = async ({
  snapshotStore,
  referencePath,
  actualBuffer,
  diffBuffer,
}: {
  snapshotStore: ScreenshotSnapshotStore;
  referencePath: string;
  actualBuffer: Buffer;
  diffBuffer?: Buffer;
}): Promise<{ actualPath: string; diffPath?: string }> => {
  const paths = getFailurePaths(referencePath);
  await writeScreenshot(snapshotStore, paths.actual, actualBuffer);
  if (diffBuffer) {
    await writeScreenshot(snapshotStore, paths.diff, diffBuffer);
    return { actualPath: paths.actual, diffPath: paths.diff };
  }
  return { actualPath: paths.actual };
};

const validateOptions = (
  options: ScreenshotMatchOptions | undefined,
): Required<ScreenshotMatchOptions> => {
  const result = {
    threshold: options?.threshold ?? 0.1,
    maxDiffPixels: options?.maxDiffPixels ?? 0,
    maxDiffPixelRatio: options?.maxDiffPixelRatio ?? 0,
  };
  if (
    !Number.isFinite(result.threshold) ||
    result.threshold < 0 ||
    result.threshold > 1
  ) {
    throw new Error('toMatchScreenshot threshold must be between 0 and 1.');
  }
  if (
    !Number.isFinite(result.maxDiffPixels) ||
    result.maxDiffPixels < 0 ||
    !Number.isInteger(result.maxDiffPixels)
  ) {
    throw new Error(
      'toMatchScreenshot maxDiffPixels must be a non-negative integer.',
    );
  }
  if (
    !Number.isFinite(result.maxDiffPixelRatio) ||
    result.maxDiffPixelRatio < 0 ||
    result.maxDiffPixelRatio > 1
  ) {
    throw new Error(
      'toMatchScreenshot maxDiffPixelRatio must be between 0 and 1.',
    );
  }
  if (
    options?.maxDiffPixels !== undefined &&
    options.maxDiffPixelRatio !== undefined
  ) {
    throw new Error(
      'toMatchScreenshot accepts either maxDiffPixels or maxDiffPixelRatio, not both.',
    );
  }
  return result;
};

export const matchBrowserScreenshot = async ({
  snapshotStore,
  testPath,
  projectName,
  testName,
  browserName,
  screenshotBase64,
  updateSnapshot,
  options,
}: {
  snapshotStore: ScreenshotSnapshotStore;
  testPath: string;
  projectName: string;
  testName: string;
  browserName: string;
  screenshotBase64: string;
  updateSnapshot: SnapshotUpdateState;
  options?: ScreenshotMatchOptions;
}): Promise<void> => {
  const normalizedOptions = validateOptions(options);
  const filepath = resolveScreenshotPath(
    testPath,
    projectName,
    testName,
    browserName,
  );
  const actualBuffer = Buffer.from(screenshotBase64, 'base64');
  const actual = PNG.sync.read(actualBuffer);
  const expectedContent = await snapshotStore.read(filepath);
  const expectedBuffer =
    expectedContent === null
      ? undefined
      : Buffer.from(expectedContent, 'base64');

  if (!expectedBuffer) {
    if (updateSnapshot === 'new' || updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer);
      await removeFailureArtifacts(snapshotStore, filepath);
      return;
    }
    throw new ScreenshotMismatchError(
      `No screenshot reference found for "${testName}". Run Rstest with --update to create it.\nReference: ${filepath}`,
    );
  }

  let expected: PNG;
  try {
    expected = PNG.sync.read(expectedBuffer);
  } catch (error) {
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer);
      await removeFailureArtifacts(snapshotStore, filepath);
      return;
    }

    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
    });
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new ScreenshotMismatchError(
      `Screenshot reference for "${testName}" is not a valid PNG.${reason}\nReference: ${filepath}\nActual: ${artifacts.actualPath}\nRun Rstest with --update to replace it.`,
    );
  }
  if (expected.width !== actual.width || expected.height !== actual.height) {
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer);
      await removeFailureArtifacts(snapshotStore, filepath);
      return;
    }
    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
      diffBuffer: createDimensionDiff(expected, actual),
    });
    throw new ScreenshotMismatchError(
      `Screenshot dimensions differ for "${testName}": expected ${expected.width}x${expected.height}, received ${actual.width}x${actual.height}.\nReference: ${filepath}\nActual: ${artifacts.actualPath}\nDiff: ${artifacts.diffPath}\nRun Rstest with --update to replace it.`,
    );
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const differentPixels = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    expected.width,
    expected.height,
    { threshold: normalizedOptions.threshold },
  );
  const maxDiffPixels = Math.max(
    normalizedOptions.maxDiffPixels,
    Math.floor(
      expected.width * expected.height * normalizedOptions.maxDiffPixelRatio,
    ),
  );

  if (differentPixels > maxDiffPixels) {
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer);
      await removeFailureArtifacts(snapshotStore, filepath);
      return;
    }
    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
      diffBuffer: PNG.sync.write(diff),
    });
    throw new ScreenshotMismatchError(
      `Screenshot does not match the stored reference for "${testName}": ${differentPixels} pixels differ (allowed: ${maxDiffPixels}).\nReference: ${filepath}\nActual: ${artifacts.actualPath}\nDiff: ${artifacts.diffPath}\nRun Rstest with --update to replace it.`,
    );
  }

  await removeFailureArtifacts(snapshotStore, filepath);
};

const removeFailureArtifacts = async (
  snapshotStore: ScreenshotSnapshotStore,
  referencePath: string,
): Promise<void> => {
  await Promise.all(
    Object.values(getFailurePaths(referencePath)).map((path) =>
      snapshotStore.remove(path),
    ),
  );
};
