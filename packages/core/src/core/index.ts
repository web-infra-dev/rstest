import type {
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { Rstest } from './rstest';

export function createRstest(
  {
    config,
    projects,
    configFilePath,
  }: {
    config: RstestConfig;
    configFilePath?: string;
    projects: Project[];
  },
  command: RstestCommand,
  fileFilters: string[],
): RstestInstance {
  const context = new Rstest(
    {
      cwd: process.cwd(),
      command,
      fileFilters,
      configFilePath,
      projects,
    },
    config,
  );

  const runTests = async (): Promise<void> => {
    const { runTests } = await import('./runTests');
    await runTests(context);
  };

  const listTests = async (options: ListCommandOptions) => {
    const { listTests } = await import('./listTests');
    return listTests(context, options);
  };

  const mergeReports = async (options?: {
    path?: string;
    cleanup?: boolean;
  }): Promise<void> => {
    const { mergeReports } = await import('./mergeReports');
    await mergeReports(context, options);
  };

  return {
    context,
    runTests,
    listTests,
    mergeReports,
  };
}
