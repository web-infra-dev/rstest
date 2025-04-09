import { createRequire as createNativeRequire } from 'node:module';
import vm from 'node:vm';
import path from 'pathe';
import { logger } from '../utils/logger';

const isRelativePath = (p: string) => /^\.\.?\//.test(p);

const createRequire = (
  filename: string,
  distPath: string,
  rstestContext: Record<string, any>,
  assetFiles: Record<string, string>,
): NodeJS.Require => {
  const _require = createNativeRequire(filename);
  const require = ((id: string) => {
    const currentDirectory = path.dirname(distPath);

    const joinedPath = isRelativePath(id)
      ? path.join(currentDirectory, id)
      : id;

    const content = assetFiles[joinedPath];

    if (content) {
      try {
        return loadModule({
          codeContent: content,
          originPath: joinedPath,
          distPath: joinedPath,
          rstestContext,
          assetFiles,
        });
      } catch (err) {
        logger.error(
          `load file ${joinedPath} failed:\n`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    const resolved = _require.resolve(id);
    return _require(resolved);
  }) as NodeJS.Require;
  require.resolve = _require.resolve;
  require.main = _require.main;
  return require;
};

export const loadModule = ({
  codeContent,
  distPath,
  originPath,
  rstestContext,
  assetFiles,
}: {
  codeContent: string;
  distPath: string;
  originPath: string;
  rstestContext: Record<string, any>;
  assetFiles: Record<string, string>;
}): any => {
  const fileDir = path.dirname(originPath);

  const localModule = {
    children: [],
    exports: {},
    filename: originPath,
    id: originPath,
    isPreloading: false,
    loaded: false,
    path: fileDir,
  };

  const context = {
    module: localModule,
    exports: localModule.exports,
    require: createRequire(originPath, distPath, rstestContext, assetFiles),
    __dirname: fileDir,
    __filename: originPath,
    ...rstestContext,
  };

  const codeDefinition = `'use strict';(${Object.keys(context).join(',')})=>{{`;
  const code = `${codeDefinition}${codeContent}\n}}`;

  const fn = vm.runInThisContext(code, {
    // Used in stack traces produced by this script.
    filename: distPath,
    lineOffset: 0,
    columnOffset: -codeDefinition.length,
  });
  fn(...Object.values(context));

  return localModule.exports;
};
