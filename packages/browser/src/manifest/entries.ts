import {
  getSetupFiles,
  getTestEntries,
  type Rstest,
} from '@rstest/core/browser';
import { normalize } from 'pathe';
import type { BrowserProjectEntries } from '../runtime/types';
import { getBrowserProjects } from './projectConfig';

export const collectProjectEntries = async (
  context: Rstest,
): Promise<BrowserProjectEntries[]> => {
  const projectEntries: BrowserProjectEntries[] = [];

  const browserProjects = getBrowserProjects(context);

  for (const project of browserProjects) {
    const {
      normalizedConfig: { include, exclude, includeSource, setupFiles },
    } = project;

    const tests = await getTestEntries({
      include,
      exclude: exclude.patterns,
      includeSource,
      rootPath: context.rootPath,
      projectRoot: project.rootPath,
      fileFilters: context.fileFilters || [],
    });

    const setup = getSetupFiles(setupFiles, project.rootPath);

    projectEntries.push({
      project,
      setupFiles: Object.values(setup),
      testFiles: Object.values(tests).map((testPath) => normalize(testPath)),
    });
  }

  return projectEntries;
};
