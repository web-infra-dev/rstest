import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'pathe';
import { color, logger } from '../utils';

const BUNDLE_COVERAGE_DEBUG = 'rstest:bundle-coverage';

export type BundleCoverageResult = {
  project: string;
  testPath: string;
  assets: Record<string, number>;
  rawV8: unknown | null;
};

export const isBundleCoverageDebugEnabled = (): boolean =>
  process.env.DEBUG?.toLowerCase().split(',').includes(BUNDLE_COVERAGE_DEBUG) ??
  false;

export const writeBundleCoverageResults = async (
  rootPath: string,
  results: BundleCoverageResult[],
): Promise<void> => {
  if (!results.length) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const outputPath = resolve(
    rootPath,
    '.rstest',
    `bundle-coverage-${stamp}.json`,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify({
      version: 1,
      tests: results.toSorted(
        (a, b) =>
          a.project.localeCompare(b.project) ||
          a.testPath.localeCompare(b.testPath),
      ),
    }),
  );
  logger.log(color.gray('  Bundle coverage file: '), color.cyan(outputPath));
};
