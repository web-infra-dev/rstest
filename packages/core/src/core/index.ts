import type {
  ListCommandOptions,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { createContext } from './context';

export function createRstest(
  {
    config,
    configFilePath,
  }: {
    config: RstestConfig;
    configFilePath?: string;
  },
  command: RstestCommand,
  fileFilters: string[],
): RstestInstance {
  const context = createContext(
    { cwd: process.cwd(), command, fileFilters, configFilePath },
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
