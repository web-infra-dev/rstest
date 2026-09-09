import type {
  ListCommandCollectOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { Rstest } from './rstest';

export type CoreRstestInstance = Omit<RstestInstance, 'context'> & {
  context: Rstest;
};

export function createRstest(
  {
    config,
    projects,
    configFilePath,
    trace,
    cwd = process.cwd(),
    embedded = false,
    initializeReporters,
  }: {
    config: RstestConfig;
    configFilePath?: string;
    projects: Project[];
    /** CLI-only `--trace` switch; not exposed via user config. */
    trace?: boolean;
    /** Working directory; defaults to `process.cwd()`. */
    cwd?: string;
    /**
     * When true, Rstest won't install `process.on('exit' | 'SIG*')` handlers
     * or stdin shortcuts. Set by the `@rstest/core/api` adapter.
     */
    embedded?: boolean;
    /** Internal metadata contexts normalize config without creating reporters. */
    initializeReporters?: boolean;
  },
  command: RstestCommand,
  fileFilters?: string[],
): CoreRstestInstance {
  const context = new Rstest(
    {
      cwd,
      command,
      fileFilters,
      configFilePath,
      projects,
      trace,
      embedded,
      initializeReporters,
    },
    config,
  );

  const runTests = async (): Promise<void> => {
    const { runTests } = await import('./runTests');
    await runTests(context);
  };

  const listTests = async (options: ListCommandCollectOptions) => {
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
