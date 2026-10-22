import type { LoadConfigResult } from '@rsbuild/core';
import type { RstestConfig } from './types';

/**
 * Lets a host that runs Rstest for its users (e.g. Rstack CLI) keep the test
 * config in its own config file, such as `rstack.config.ts`. Directories and
 * files that `projects` entries expand to are otherwise loaded only from
 * `rstest.config.*`; a loader set under this key loads them instead.
 *
 * Only the key on the root config is read. Nested `projects` are loaded with
 * the root loader too, and the loader may be called concurrently.
 *
 * @example
 * ```ts
 * import { type LoadProjectConfig, PROJECT_LOADER } from '@rstest/core/api';
 *
 * const loadProject: LoadProjectConfig = async ({ dirPath, filePath }) => {
 *   const configFile = filePath ?? findHostConfig(dirPath);
 *   if (!configFile) return null;
 *   const { test, dependencies } = await loadHostConfig(configFile);
 *   return { content: test, filePath: configFile, dependencies };
 * };
 *
 * export default async () => {
 *   const { test } = await loadHostConfig(findHostConfig(process.cwd()));
 *   return { ...test, [PROJECT_LOADER]: loadProject };
 * };
 * ```
 */
export const PROJECT_LOADER: unique symbol = Symbol.for(
  'rstest project loader',
);

/**
 * Called with `{ dirPath }` for a directory entry and `{ dirPath, filePath }`
 * for a file entry. The result is handled like a loaded `rstest.config.*`;
 * `null` creates the project from an empty config without falling back to
 * `rstest.config.*`.
 */
export type LoadProjectConfig = (ctx: {
  /** Absolute, normalized directory of the project being loaded. */
  dirPath: string;
  /** Absolute, normalized config file path, present only for file entries. */
  filePath?: string;
}) =>
  | LoadConfigResult<RstestConfig>
  | null
  | Promise<LoadConfigResult<RstestConfig> | null>;

export const getProjectLoader = (
  config: RstestConfig & { [PROJECT_LOADER]?: LoadProjectConfig },
): LoadProjectConfig | undefined => config[PROJECT_LOADER];
