import type { RstestCommand, RstestConfig, RstestInstance } from '../types';
import { createContext } from './context';

export function createRstest(
  config: RstestConfig,
  command: RstestCommand,
): RstestInstance {
  const context = createContext({ cwd: process.cwd(), command }, config);

  const runTests = async (): Promise<void> => {
    const { runTests } = await import('./runTests');
    await runTests(context);
  };

  return {
    runTests,
  };
}
