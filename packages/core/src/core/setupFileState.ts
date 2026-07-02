import type { ProjectContext } from '../types';
import { collectSetupPaths, getSetupFiles } from '../utils/getSetupFiles';

export type SetupFileProjects = {
  setupProjects: ProjectContext[];
  globalSetupProjects: ProjectContext[];
};

export type SetupFileState = {
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
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

  const refresh = ({
    setupProjects,
    globalSetupProjects,
  }: SetupFileProjects): void => {
    clearRecord(setupFiles);
    clearRecord(globalSetupFiles);

    for (const project of setupProjects) {
      setupFiles[project.environmentName] = getSetupFiles(
        project.normalizedConfig.setupFiles ?? [],
        project.rootPath,
      );
    }

    for (const project of globalSetupProjects) {
      globalSetupFiles[project.environmentName] = getSetupFiles(
        project.normalizedConfig.globalSetup ?? [],
        project.rootPath,
      );
    }
  };

  return {
    setupFiles,
    globalSetupFiles,
    refresh,
    getSetupPaths: () => collectSetupPaths(setupFiles, globalSetupFiles),
  };
};
