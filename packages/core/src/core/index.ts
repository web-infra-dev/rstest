import type {
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { createContext } from './context';

export function createRstest(
  {
    config,
    projects,
  }: {
    config: RstestConfig;
    projects: Project[];
  },
  command: RstestCommand,
  fileFilters: string[],
): RstestInstance {
  const context = createContext(
    { cwd: process.cwd(), command },
    config,
    projects,
  );

  const runTests = async (): Promise<void> => {
    const { runTests } = await import('./runTests');
    await runTests(context, fileFilters);
  };

  const listTests = async (options: ListCommandOptions): Promise<void> => {
    const { listTests } = await import('./listTests');
    await listTests(context, fileFilters, options);
  };

  return {
    context,
    runTests,
    listTests,
  };
}
