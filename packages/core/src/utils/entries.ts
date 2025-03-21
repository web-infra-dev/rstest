import path from 'node:path';
import { glob } from 'tinyglobby';

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

export const getTestEntries = async ({
  include,
  exclude,
  root,
  fileFilters,
}: {
  include: string[];
  exclude: string[];
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

  return Object.fromEntries(
    filterFiles(testFiles, fileFilters, root).map((entry) => {
      const name = path.relative(root, entry);
      return [name, entry];
    }),
  );
};
