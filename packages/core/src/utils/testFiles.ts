import fs from 'node:fs/promises';
import path from 'pathe';
import { glob } from 'tinyglobby';
import { castArray, color, getAbsolutePath, parsePosix } from './helper';

export const filterFiles = (
  testFiles: string[],
  filters: string[],
  dir: string,
): string[] => {
  if (!filters.length) {
    return testFiles;
  }

  const fileFilters =
    process.platform === 'win32'
      ? filters.map((f) => f.split(path.sep).join('/'))
      : filters;

  return testFiles.filter((t) => {
    const testFile = path.relative(dir, t).toLocaleLowerCase();
    return fileFilters.some((f) => {
      // if filter is a full file path, we should include it if it's in the same folder
      if (path.isAbsolute(f) && t.startsWith(f)) {
        return true;
      }

      const relativePath = f.endsWith('/')
        ? path.join(path.relative(dir, f), '/')
        : path.relative(dir, f);
      return (
        testFile.includes(f.toLocaleLowerCase()) ||
        testFile.includes(relativePath.toLocaleLowerCase())
      );
    });
  });
};

const hasInSourceTestCode = (code: string): boolean =>
  code.includes('import.meta.rstest');

export const getTestEntries = async ({
  include,
  exclude,
  root,
  fileFilters,
  includeSource,
}: {
  include: string[];
  exclude: string[];
  includeSource: string[];
  fileFilters: string[];
  root: string;
}): Promise<{
  [name: string]: string;
}> => {
  const testFiles = await glob(include, {
    cwd: root,
    absolute: true,
    ignore: exclude,
    dot: true,
    expandDirectories: false,
  });

  if (includeSource?.length) {
    const sourceFiles = await glob(includeSource, {
      cwd: root,
      absolute: true,
      ignore: exclude,
      dot: true,
      expandDirectories: false,
    });

    await Promise.all<void>(
      sourceFiles.map(async (file) => {
        try {
          const code = await fs.readFile(file, 'utf-8');
          if (hasInSourceTestCode(code)) {
            testFiles.push(file);
          }
        } catch {
          return;
        }
      }),
    );
  }

  return Object.fromEntries(
    filterFiles(testFiles, fileFilters, root).map((entry) => {
      const name = path.relative(root, entry);
      return [name, entry];
    }),
  );
};

export const getSetupFiles = (
  setups: string[] | string | undefined,
  rootPath: string,
): Record<string, string> => {
  return Object.fromEntries(
    castArray(setups).map((setupFile) => {
      const setupFilePath = getAbsolutePath(rootPath, setupFile);
      const name = path.relative(rootPath, setupFilePath);
      return [name, setupFilePath];
    }),
  );
};

export const prettierTestPath = (
  testPath: string,
  highlightFileName = true,
): string => {
  const { dir, base } = parsePosix(testPath);

  if (!highlightFileName) {
    return `${color.dim(`${dir}/`)}${base}`;
  }
  const ext = base.match(/(\.(spec|test)\.[cm]?[tj]sx?)$/)?.[0] || '';
  const name = base.replace(ext, '');
  return `${color.dim(`${dir}/`)}${name}${ext ? color.dim(ext) : ''}`;
};

export const formatTestPath = (root: string, testFilePath: string): string => {
  let testPath = testFilePath;
  if (path.isAbsolute(testPath)) {
    testPath = path.relative(root, testPath);
  }

  return prettierTestPath(testPath);
};
