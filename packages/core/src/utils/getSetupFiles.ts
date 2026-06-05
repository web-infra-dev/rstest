import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rsbuild/core';
import pathe from 'pathe';
import { getAbsolutePath } from './helper';
import { color } from './logger';
import { formatTestEntryName } from './testFiles';

const tryResolve = (request: string, rootPath: string) => {
  const { resolver } = rspack.experiments;
  const esmFirstResolver = new resolver.ResolverFactory({
    conditionNames: ['node', 'import', 'require'],
  });
  const { path: resolvedPath } = esmFirstResolver.sync(rootPath, request);
  return resolvedPath;
};

/**
 * Flatten one or more `{ [env]: { [entry]: path } }` setup maps into a flat
 * list of setup file paths.
 *
 * Iterates the groups separately on purpose: a `{ ...a, ...b }` spread merges
 * by environment name, so an empty map would clobber a populated entry for the
 * same environment and drop its paths.
 */
export const collectSetupPaths = (
  ...groups: Record<string, Record<string, string>>[]
): string[] =>
  groups.flatMap((group) =>
    Object.values(group).flatMap((files) => Object.values(files)),
  );

export const getSetupFiles = (
  setups: string[],
  rootPath: string,
): Record<string, string> => {
  if (!setups.length) {
    return {};
  }
  return Object.fromEntries(
    setups.map((filePath) => {
      const setupFile = filePath.startsWith('file://')
        ? fileURLToPath(filePath)
        : filePath;
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
        const resolvedPath = tryResolve(setupFile, rootPath);
        // support use package name as setupFiles value
        if (resolvedPath) {
          return [formatTestEntryName(setupFile), resolvedPath];
        }
        throw err;
      }
    }),
  );
};
