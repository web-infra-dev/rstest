import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rsbuild/core';
import pathe from 'pathe';
import { generateFilePathHash, getAbsolutePath } from './helper';
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

const JAVASCRIPT_DATA_URL_RE =
  /^data:(?:text|application)\/javascript(?:;charset=utf-8)?;base64,(.*)$/;

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
      if (JAVASCRIPT_DATA_URL_RE.test(filePath)) {
        return [
          `virtual~setup~${generateFilePathHash(rootPath, filePath)}`,
          filePath,
        ];
      }

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

export const materializeVirtualSetupFiles = (
  setupFiles: Record<string, string>,
  rootPath: string,
): {
  setupFiles: Record<string, string>;
  virtualModules: Record<string, string>;
} => {
  const virtualModules: Record<string, string> = {};
  const entries = Object.fromEntries(
    Object.entries(setupFiles).map(([entryName, request]) => {
      const match = JAVASCRIPT_DATA_URL_RE.exec(request);
      if (!match) {
        return [entryName, request];
      }
      const encodedSource = match[1];
      if (encodedSource === undefined) {
        return [entryName, request];
      }

      const virtualPath = pathe.join(
        rootPath,
        '.rstest-virtual',
        `${entryName}.mjs`,
      );
      virtualModules[virtualPath] = Buffer.from(
        encodedSource,
        'base64',
      ).toString('utf8');
      return [entryName, virtualPath];
    }),
  );

  return { setupFiles: entries, virtualModules };
};
