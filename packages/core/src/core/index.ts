import type {
  ListCommandOptions,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { createContext } from './context';

export function createRstest(
  config: RstestConfig,
  command: RstestCommand,
  fileFilters: string[],
): RstestInstance {
  const context = createContext(
    { cwd: process.cwd(), command, fileFilters },
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
