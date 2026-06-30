import type { ProjectContext } from '../types';
import { getSetupFiles } from '../utils/getSetupFiles';

type SetupFileMaps = {
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
};

const clearRecord = (record: Record<string, unknown>): void => {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
};

export const refreshSetupFileMaps = ({
  setupFiles,
  globalSetupFiles,
  setupProjects,
  globalSetupProjects,
}: SetupFileMaps & {
  setupProjects: ProjectContext[];
  globalSetupProjects: ProjectContext[];
}): void => {
  clearRecord(setupFiles);
  clearRecord(globalSetupFiles);

  for (const project of setupProjects) {
    setupFiles[project.environmentName] = getSetupFiles(
      project.normalizedConfig.setupFiles,
      project.rootPath,
    );
  }

  for (const project of globalSetupProjects) {
    globalSetupFiles[project.environmentName] = getSetupFiles(
      project.normalizedConfig.globalSetup,
      project.rootPath,
    );
  }
};
