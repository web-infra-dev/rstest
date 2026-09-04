import type { InternalProjectContext } from '../types';
import {
  collectSetupPaths,
  getSetupFiles,
  materializeVirtualSetupFiles,
} from '../utils/getSetupFiles';

export type SetupFileProjects = {
  setupProjects: InternalProjectContext[];
  globalSetupProjects: InternalProjectContext[];
};

export type SetupFileState = {
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
  virtualModules: Record<string, Record<string, string>>;
  refresh: (projects: SetupFileProjects) => void;
  getSetupPaths: () => string[];
};

const clearRecord = (record: Record<string, unknown>): void => {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
};

export const createSetupFileState = (): SetupFileState => {
  const setupFiles: Record<string, Record<string, string>> = {};
  const globalSetupFiles: Record<string, Record<string, string>> = {};
  const virtualModules: Record<string, Record<string, string>> = {};

  const refresh = ({
    setupProjects,
    globalSetupProjects,
  }: SetupFileProjects): void => {
    clearRecord(setupFiles);
    clearRecord(globalSetupFiles);
    clearRecord(virtualModules);

    for (const project of setupProjects) {
      const resolved = materializeVirtualSetupFiles(
        getSetupFiles(
          project.normalizedConfig.setupFiles ?? [],
          project.rootPath,
        ),
        project.rootPath,
      );
      setupFiles[project.environmentName] = resolved.setupFiles;
      virtualModules[project.environmentName] = resolved.virtualModules;
    }

    for (const project of globalSetupProjects) {
      const resolved = materializeVirtualSetupFiles(
        getSetupFiles(
          project.normalizedConfig.globalSetup ?? [],
          project.rootPath,
        ),
        project.rootPath,
      );
      globalSetupFiles[project.environmentName] = resolved.setupFiles;
      Object.assign(
        (virtualModules[project.environmentName] ??= {}),
        resolved.virtualModules,
      );
    }
  };

  return {
    setupFiles,
    globalSetupFiles,
    virtualModules,
    refresh,
    getSetupPaths: () => collectSetupPaths(setupFiles, globalSetupFiles),
  };
};
