import type {
  FileFilterMode,
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestRunner,
} from '../types';
import { Rstest } from './rstest';

/**
 * Build an internal {@link RstestRunner} for a single command + filter set. The
 * public, async, instance-shaped `createRstest` (with `run`/`listTests`/
 * `close`) lives in `@rstest/core/api` and composes this factory.
 */
export function createRstestContext(
  {
    config,
    projects,
    configFilePath,
    trace,
    cwd = process.cwd(),
    embedded = false,
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
     * programmatic run can't kill the host process. (`process.exitCode` is
     * still written; `executeHostSafeRun` restores it via try/finally.) Set by
     * the `@rstest/core/api` adapter.
     */
    embedded?: boolean;
  },
  command: RstestCommand,
  fileFilters: string[],
  fileFilterMode?: FileFilterMode,
): RstestRunner {
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
