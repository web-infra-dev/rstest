import type { RstestConfig, RstestInstance } from '../types';
import { createContext } from './context';

export function createRstest(config: RstestConfig): RstestInstance {
  const context = createContext({ cwd: process.cwd() }, config);

  const runTests = async (): Promise<void> => {
    const { runTests } = await import('./runTests');
    await runTests(context);
  };

  return {
    runTests,
  };
}
