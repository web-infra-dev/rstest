import { existsSync } from 'node:fs';
import { join, relative } from 'pathe';
import type { RstestConfig } from '@rstest/core';
import { type LoadProjectConfig, PROJECT_LOADER } from '@rstest/core/api';
// @ts-expect-error untyped fixture helper
import { loadHostConfig } from './host.mjs';

const loadProject: LoadProjectConfig = ({ dirPath, filePath: configFile }) => {
  console.log(
    `[project-loader] ${JSON.stringify({
      dirPath: relative(import.meta.dirname, dirPath),
      ...(configFile
        ? { filePath: relative(import.meta.dirname, configFile) }
        : {}),
    })}`,
  );
  const filePath = configFile ?? join(dirPath, 'custom.config.mts');
  if (!existsSync(filePath)) {
    return null;
  }
  return loadHostConfig(filePath);
};

export const createRootConfig = (
  projects: string[],
): RstestConfig & { [PROJECT_LOADER]?: LoadProjectConfig } => ({
  projects,
  [PROJECT_LOADER]: loadProject,
});
