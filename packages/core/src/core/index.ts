import type {
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { Rstest } from './rstest';

export { initCli } from '../cli';

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
    // Check if browser mode is enabled in root config or any project config
    const browserEnabled =
      context.normalizedConfig.browser.enabled ||
      context.projects.some(
        (project) => project.normalizedConfig.browser.enabled,
      );

    if (browserEnabled) {
      const { runBrowserTests } = await import('../browser');
      await runBrowserTests(context);
    } else {
      const { runTests } = await import('./runTests');
      await runTests(context);
    }
  };

  const listTests = async (options: ListCommandOptions) => {
    const { listTests } = await import('./listTests');
    return listTests(context, options);
  };

  return {
    context,
    runTests,
    listTests,
  };
}
