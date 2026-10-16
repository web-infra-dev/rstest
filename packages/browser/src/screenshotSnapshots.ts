import { createHash } from 'node:crypto';
import pixelmatch from 'pixelmatch';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from 'pathe';
import { PNG } from 'pngjs';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { ScreenshotMatchOutcome } from './rpcProtocol';

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
  stabilityTimeout?: number;
  maskColor?: string;
  style?: string;
  caret?: 'hide' | 'initial';
  scale?: 'css' | 'device';
  omitBackground?: boolean;
};

export type ScreenshotPathOptions = {
  testFilePath: string;
  projectName: string;
  testName: string;
  browserName: 'chromium' | 'firefox' | 'webkit';
  platform: string;
  screenshotAssertionOrdinal?: number;
};

const screenshotNameByteLimit = 240;
const isWindowsReservedName = (name: string): boolean =>
  /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(
    name.replace(/[ .]+$/, '').split('.')[0] ?? '',
  );
const isSafeScreenshotName = (name: string, assertionSuffix: string): boolean =>
  /^[a-z0-9]+(?: [a-z0-9]+)*$/.test(name) &&
  !isWindowsReservedName(name) &&
  !(assertionSuffix === '' && / [1-9]\d*$/.test(name));

const sanitizeScreenshotName = (
  name: string,
  fileSuffix: string,
  assertionSuffix: string,
): string => {
  const normalizedName = relative('/', join('/', name));
  return normalizedName
    .split('/')
    .map((segment, index, segments) => {
      const sanitized = segment
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/-{2,}/g, '-');
      const isLastSegment = index === segments.length - 1;
      const suffix = isLastSegment ? `${assertionSuffix}${fileSuffix}` : '';
      const hashSource =
        isLastSegment && normalizedName !== name ? name : segment;
      const needsHash =
        hashSource !== segment ||
        !isSafeScreenshotName(segment, isLastSegment ? assertionSuffix : '') ||
        Buffer.byteLength(`${sanitized}${suffix}`) > screenshotNameByteLimit;
      const hash = needsHash
        ? `~${createHash('sha256').update(hashSource).digest('hex')}`
        : '';
      const prefixLimit =
        screenshotNameByteLimit - Buffer.byteLength(`${hash}${suffix}`);
      let prefix = '';
      let prefixBytes = 0;
      for (const character of sanitized) {
        const characterBytes = Buffer.byteLength(character);
        if (prefixBytes + characterBytes > prefixLimit) {
          break;
        }
        prefix += character;
        prefixBytes += characterBytes;
      }
      return `${prefix}${hash}${isLastSegment ? assertionSuffix : ''}`;
    })
    .join('/');
};

const resolveScreenshotPath = (
  rootPath: string,
  testPath: string,
  projectName: string,
  testName: string,
  browserName: ScreenshotPathOptions['browserName'],
  platform: string,
  screenshotAssertionOrdinal?: number,
  screenshotDirectory?: string,
  resolvePath?: (options: ScreenshotPathOptions) => string,
): string =>
  (() => {
    const pathOptions = {
      testFilePath: testPath,
      projectName,
      testName,
      browserName,
      platform,
      screenshotAssertionOrdinal,
    };
    if (resolvePath) {
      const customPath = resolvePath(pathOptions);
      if (!customPath) {
        throw new Error('resolveScreenshotPath must return a non-empty path.');
      }
      return isAbsolute(customPath)
        ? customPath
        : resolve(rootPath, customPath);
    }
    const assertionSuffix =
      screenshotAssertionOrdinal === undefined
        ? ''
        : `-${screenshotAssertionOrdinal}`;
    const fileSuffix = `-${browserName}-${platform}.png`;
    const testDirectory = dirname(testPath);
    const referenceRoot = resolve(
      testDirectory,
      screenshotDirectory ?? '__screenshots__',
    );
    const referenceLocation = relative(testDirectory, referenceRoot);
    const isSharedDirectory =
      (screenshotDirectory !== undefined && isAbsolute(screenshotDirectory)) ||
      referenceLocation === '..' ||
      referenceLocation.startsWith('../');
    const sourceDirectory = relative(rootPath, testDirectory);
    const testDirectoryUnderReferenceRoot = isSharedDirectory
      ? sourceDirectory === '..' ||
        sourceDirectory.startsWith('../') ||
        isAbsolute(sourceDirectory)
        ? join(
            '__external__',
            createHash('sha256').update(testDirectory).digest('hex'),
          )
        : sourceDirectory
      : '';
    return resolve(
      referenceRoot,
      testDirectoryUnderReferenceRoot,
      basename(testPath),
      `${sanitizeScreenshotName(testName, fileSuffix, assertionSuffix)}${fileSuffix}`,
    );
  })();

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
  save: (
    filepath: string,
    contentBase64: string,
    deadline?: number,
  ) => Promise<void>;
  remove: (filepath: string, deadline?: number) => Promise<void>;
};

export type { ScreenshotMatchOutcome };

const throwIfScreenshotDeadlinePassed = (deadline?: number): void => {
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new Error('Screenshot assertion exceeded the active test timeout.');
  }
};

const runBeforeScreenshotDeadline = <T>(
  operation: () => Promise<T>,
  deadline?: number,
): Promise<T> => {
  throwIfScreenshotDeadlinePassed(deadline);
  if (deadline === undefined) {
    return operation();
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () =>
        reject(
          new Error('Screenshot assertion exceeded the active test timeout.'),
        ),
      deadline - Date.now(),
    );
    operation().then(
      (value) => {
        clearTimeout(timeoutId);
        try {
          throwIfScreenshotDeadlinePassed(deadline);
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
};

const writeScreenshot = async (
  snapshotStore: ScreenshotSnapshotStore,
  filepath: string,
  screenshot: Buffer,
  deadline?: number,
): Promise<void> =>
  runBeforeScreenshotDeadline(
    () => snapshotStore.save(filepath, screenshot.toString('base64'), deadline),
    deadline,
  );

const writeFailureArtifacts = async ({
  snapshotStore,
  referencePath,
  actualBuffer,
  diffBuffer,
  deadline,
}: {
  snapshotStore: ScreenshotSnapshotStore;
  referencePath: string;
  actualBuffer: Buffer;
  diffBuffer?: Buffer;
  deadline?: number;
}): Promise<{ actualPath: string; diffPath?: string }> => {
  const paths = getFailurePaths(referencePath);
  await writeScreenshot(snapshotStore, paths.actual, actualBuffer, deadline);
  if (diffBuffer) {
    await writeScreenshot(snapshotStore, paths.diff, diffBuffer, deadline);
    return { actualPath: paths.actual, diffPath: paths.diff };
  }
  return { actualPath: paths.actual };
};

const validateOptions = (
  options: ScreenshotMatchOptions | undefined,
): Required<
  Pick<
    ScreenshotMatchOptions,
    'threshold' | 'maxDiffPixels' | 'maxDiffPixelRatio'
  >
> => {
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
  rootPath = dirname(testPath),
  projectName,
  testName,
  browserName,
  screenshotBase64,
  updateSnapshot,
  options,
  deadline,
  screenshotAssertionOrdinal,
  screenshotDirectory,
  resolvePath,
  platform = process.platform,
}: {
  snapshotStore: ScreenshotSnapshotStore;
  testPath: string;
  rootPath?: string;
  projectName: string;
  testName: string;
  browserName: 'chromium' | 'firefox' | 'webkit';
  screenshotBase64: string;
  updateSnapshot: SnapshotUpdateState;
  options?: ScreenshotMatchOptions;
  deadline?: number;
  screenshotAssertionOrdinal?: number;
  screenshotDirectory?: string;
  resolvePath?: (options: ScreenshotPathOptions) => string;
  platform?: string;
}): Promise<ScreenshotMatchOutcome> => {
  throwIfScreenshotDeadlinePassed(deadline);
  const normalizedOptions = validateOptions(options);
  const filepath = resolveScreenshotPath(
    rootPath,
    testPath,
    projectName,
    testName,
    browserName,
    platform,
    screenshotAssertionOrdinal,
    screenshotDirectory,
    resolvePath,
  );
  const actualBuffer = Buffer.from(screenshotBase64, 'base64');
  const actual = PNG.sync.read(actualBuffer);
  throwIfScreenshotDeadlinePassed(deadline);
  const expectedContent = await runBeforeScreenshotDeadline(
    () => snapshotStore.read(filepath),
    deadline,
  );
  const expectedBuffer =
    expectedContent === null
      ? undefined
      : Buffer.from(expectedContent, 'base64');

  if (!expectedBuffer) {
    if (updateSnapshot === 'new' || updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer, deadline);
      await removeFailureArtifacts(snapshotStore, filepath, deadline);
      return 'added';
    }
    throw new ScreenshotMismatchError(
      `No screenshot reference found for "${testName}". Run Rstest with --update to create it.\nReference: ${filepath}`,
    );
  }

  let expected: PNG;
  try {
    expected = PNG.sync.read(expectedBuffer);
  } catch (error) {
    throwIfScreenshotDeadlinePassed(deadline);
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer, deadline);
      await removeFailureArtifacts(snapshotStore, filepath, deadline);
      return 'updated';
    }

    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
      deadline,
    });
    const reason = error instanceof Error ? ` ${error.message}` : '';
    throw new ScreenshotMismatchError(
      `Screenshot reference for "${testName}" is not a valid PNG.${reason}\nReference: ${filepath}\nActual: ${artifacts.actualPath}\nRun Rstest with --update to replace it.`,
    );
  }
  throwIfScreenshotDeadlinePassed(deadline);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer, deadline);
      await removeFailureArtifacts(snapshotStore, filepath, deadline);
      return 'updated';
    }
    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
      diffBuffer: createDimensionDiff(expected, actual),
      deadline,
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
  throwIfScreenshotDeadlinePassed(deadline);
  const maxDiffPixels = Math.max(
    normalizedOptions.maxDiffPixels,
    Math.floor(
      expected.width * expected.height * normalizedOptions.maxDiffPixelRatio,
    ),
  );

  if (differentPixels > maxDiffPixels) {
    if (updateSnapshot === 'all') {
      await writeScreenshot(snapshotStore, filepath, actualBuffer, deadline);
      await removeFailureArtifacts(snapshotStore, filepath, deadline);
      return 'updated';
    }
    const artifacts = await writeFailureArtifacts({
      snapshotStore,
      referencePath: filepath,
      actualBuffer,
      diffBuffer: PNG.sync.write(diff),
      deadline,
    });
    throw new ScreenshotMismatchError(
      `Screenshot does not match the stored reference for "${testName}": ${differentPixels} pixels differ (allowed: ${maxDiffPixels}).\nReference: ${filepath}\nActual: ${artifacts.actualPath}\nDiff: ${artifacts.diffPath}\nRun Rstest with --update to replace it.`,
    );
  }

  await removeFailureArtifacts(snapshotStore, filepath, deadline);
  return 'matched';
};

const removeFailureArtifacts = async (
  snapshotStore: ScreenshotSnapshotStore,
  referencePath: string,
  deadline?: number,
): Promise<void> => {
  await runBeforeScreenshotDeadline(
    () =>
      Promise.all(
        Object.values(getFailurePaths(referencePath)).map((path) =>
          snapshotStore.remove(path, deadline),
        ),
      ),
    deadline,
  );
};
