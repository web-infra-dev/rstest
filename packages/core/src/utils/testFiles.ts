import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import pathe from 'pathe';
import { glob } from 'tinyglobby';
import type { Project } from '../types';
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
      ? filters.map((f) => f.split(pathe.sep).join('/'))
      : filters;

  return testFiles.filter((t) => {
    const testFile = pathe.relative(dir, t).toLocaleLowerCase();
    return fileFilters.some((f) => {
      // if filter is a full file path, we should include it if it's in the same folder
      if (pathe.isAbsolute(f) && t.startsWith(f)) {
        return true;
      }

      const relativePath = f.endsWith('/')
        ? pathe.join(pathe.relative(dir, f), '/')
        : pathe.relative(dir, f);
      return (
        testFile.includes(f.toLocaleLowerCase()) ||
        testFile.includes(relativePath.toLocaleLowerCase())
      );
    });
  });
};

export const filterProjects = (
  projects: Project[],
  options: {
    project?: string[];
  },
): Project[] => {
  if (options.project) {
    const regexes = castArray(options.project).map((pattern) => {
      // cast wildcard to RegExp, eg. @rstest/*, !@rstest/core
      const isNeg = pattern.startsWith('!');

      const escaped = (isNeg ? pattern.slice(1) : pattern)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(isNeg ? `^(?!${escaped})` : `^${escaped}$`);
    });

    return projects.filter((proj) =>
      regexes.some((re) => re.test(proj.config.name!)),
    );
  }

  return projects;
};

const hasInSourceTestCode = (code: string): boolean =>
  code.includes('import.meta.rstest');

// format ../setup.ts to _setup~ts
export const formatTestEntryName = (name: string): string =>
  name.replace(/\.*[/\\]/g, '_').replace(/\./g, '~');

export const getTestEntries = async ({
  include,
  exclude,
  rootPath,
  projectRoot,
  fileFilters,
  includeSource,
}: {
  rootPath: string;
  include: string[];
  exclude: string[];
  includeSource: string[];
  fileFilters: string[];
  projectRoot: string;
}): Promise<{
  [name: string]: string;
}> => {
  const testFiles = await glob(include, {
    cwd: projectRoot,
    absolute: true,
    ignore: exclude,
    dot: true,
    expandDirectories: false,
  });

  if (includeSource?.length) {
    const sourceFiles = await glob(includeSource, {
      cwd: projectRoot,
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
    filterFiles(testFiles, fileFilters, rootPath).map((entry) => {
      const relativePath = pathe.relative(rootPath, entry);
      return [formatTestEntryName(relativePath), entry];
    }),
  );
};

const tryResolve = (request: string, rootPath: string) => {
  try {
    const require = createRequire(rootPath);
    return require.resolve(request, { paths: [rootPath] });
  } catch (_err) {
    return undefined;
  }
};

export const getSetupFiles = (
  setups: string[],
  rootPath: string,
): Record<string, string> => {
  if (!setups.length) {
    return {};
  }
  return Object.fromEntries(
    setups.map((setupFile) => {
      const setupFilePath = getAbsolutePath(rootPath, setupFile);
      try {
        if (!existsSync(setupFilePath)) {
          let errorMessage = `Setup file ${color.red(setupFile)} not found`;
          if (setupFilePath !== setupFile) {
            errorMessage += color.gray(` (resolved path: ${setupFilePath})`);
          }
          throw errorMessage;
        }
        const relativePath = pathe.relative(rootPath, setupFilePath);
        return [formatTestEntryName(relativePath), setupFilePath];
      } catch (err) {
        // support use package name as setupFiles value
        if (tryResolve(setupFile, rootPath)) {
          return [formatTestEntryName(setupFile), setupFile];
        }
        throw err;
      }
    }),
  );
};

export const prettyTestPath = (testPath: string): string => {
  const { dir, base } = parsePosix(testPath);

  return `${dir !== '.' ? color.gray(`${dir}/`) : ''}${color.cyan(base)}`;
};

export const formatTestPath = (root: string, testFilePath: string): string => {
  let testPath = testFilePath;
  if (pathe.isAbsolute(testPath) && testPath.includes(root)) {
    testPath = pathe.relative(root, testPath);
  }

  return prettyTestPath(testPath);
};
