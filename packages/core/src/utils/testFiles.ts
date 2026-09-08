import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import pathe from 'pathe';
import { glob, isDynamicPattern } from 'tinyglobby';
import type { Project } from '../types';
import {
  castArray,
  isQuotedFilter,
  normalizeExactPathMatch,
  parsePosix,
  unquoteFilter,
} from './helper';
import { color } from './logger';

/**
 * Whether a CLI file filter points inside `projectRootPath`. Shared by the run
 * path's browser-subset planning and `rstest list` so both commands classify a
 * filter against the same project boundaries.
 */
export const isFilterInsideProject = (
  filter: string,
  projectRootPath: string,
  rootPath: string,
): boolean => {
  const path = unquoteFilter(filter);
  const absoluteFilter = pathe.normalize(
    pathe.isAbsolute(path) ? path : pathe.resolve(rootPath, path),
  );
  const relativeFilter = pathe.normalize(
    pathe.relative(projectRootPath, absoluteFilter),
  );

  return (
    relativeFilter === '' ||
    (!relativeFilter.startsWith('..') && !pathe.isAbsolute(relativeFilter))
  );
};

/**
 * Whether a CLI file filter is an unquoted basename fragment (no path separator,
 * no leading `.`) that substring matching applies to every project.
 */
export const isFuzzyBasenameFilter = (filter: string): boolean => {
  if (isQuotedFilter(filter) || pathe.isAbsolute(filter)) {
    return false;
  }

  const normalizedFilter = pathe.normalize(filter);
  return (
    !normalizedFilter.startsWith('.') &&
    !normalizedFilter.includes('/') &&
    !normalizedFilter.includes('\\')
  );
};

export const filterFiles = (
  testFiles: string[],
  filters: string[],
  dir: string,
): string[] => {
  if (!filters.length) {
    return [];
  }

  const fileFilters =
    process.platform === 'win32'
      ? filters.map((f) => f.split(pathe.sep).join('/'))
      : filters;

  const exactFilters = new Set<string>();
  const fuzzyFilters: string[] = [];
  for (const filter of fileFilters) {
    if (isQuotedFilter(filter)) {
      exactFilters.add(normalizeExactPathMatch(unquoteFilter(filter)));
    } else {
      fuzzyFilters.push(filter);
    }
  }

  return testFiles.filter((t) => {
    const relativePath = pathe.relative(dir, t);
    if (
      exactFilters.size > 0 &&
      (exactFilters.has(normalizeExactPathMatch(t)) ||
        exactFilters.has(normalizeExactPathMatch(relativePath)))
    ) {
      return true;
    }
    if (fuzzyFilters.length === 0) {
      return false;
    }
    const testFile = relativePath.toLocaleLowerCase();
    return fuzzyFilters.some((f) => {
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
  fileFilters?: string[];
  projectRoot: string;
}): Promise<Record<string, string>> => {
  const globOptions = {
    cwd: projectRoot,
    absolute: true,
    ignore: exclude,
    dot: true,
    expandDirectories: false,
  };

  // The include glob and the in-source glob are independent filesystem walks,
  // so run them concurrently. Passing the full `include` (literal entries
  // included) keeps `exclude` behaving exactly as before for real files.
  const [globbedFiles, sourceFiles] = await Promise.all([
    glob(include, globOptions),
    includeSource?.length ? glob(includeSource, globOptions) : [],
  ]);

  // Virtual modules (backed by `experiments.VirtualModulesPlugin`) are listed
  // as literal includes but don't exist on disk, so the glob above drops them
  // — add those back. Real literal includes already flowed through the glob, so
  // `exclude` applies to them; only genuinely-missing paths qualify as virtual
  // here, and `exclude` does not apply to those. `isDynamicPattern` mirrors
  // tinyglobby's own glob/literal split, so a glob that matches nothing is
  // never mistaken for a virtual path.
  const virtualFiles = include
    .filter((pattern) => !isDynamicPattern(pattern))
    .map((p) => pathe.resolve(projectRoot, p))
    .filter((abs) => !existsSync(abs));

  // glob already returns a unique list (as on `main`), so only build a Set to
  // dedupe when virtual entries are actually present.
  const testFiles = virtualFiles.length
    ? Array.from(new Set([...globbedFiles, ...virtualFiles]))
    : globbedFiles;

  if (sourceFiles.length) {
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
    (fileFilters === undefined
      ? testFiles
      : filterFiles(testFiles, fileFilters, rootPath)
    ).map((entry) => {
      const relativePath = pathe.relative(rootPath, entry);
      return [formatTestEntryName(relativePath), entry];
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
