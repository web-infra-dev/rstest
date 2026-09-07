import type {
  FileFilterMode,
  ListCommandOptions,
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
     * and config errors throw instead of calling `process.exit()`, so a
     * programmatic run can't kill the host process. Set by the
     * `@rstest/core/api` adapter; only CLI contexts mirror the context-local
     * status to the host process.
     */
    embedded?: boolean;
    /** Internal metadata contexts normalize config without creating reporters. */
    initializeReporters?: boolean;
  },
  command: RstestCommand,
  fileFilters?: string[],
  fileFilterMode?: FileFilterMode,
): CoreRstestInstance {
  const context = new Rstest(
    {
      cwd,
      command,
      fileFilters,
      fileFilterMode,
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
