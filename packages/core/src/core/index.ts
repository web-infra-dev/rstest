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
    const { runTests } = await import('./runTests');
    await runTests(context);
  };

  const listTests = async (options: ListCommandOptions): Promise<void> => {
    const { listTests } = await import('./listTests');
    await listTests(context, options);
  };

  return {
    context,
    runTests,
    listTests,
  };
}
