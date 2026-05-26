import type {
  FileFilterMode,
  ListCommandOptions,
  Project,
  RstestCommand,
  RstestConfig,
  RstestInstance,
} from '../types';
import { Rstest } from './rstest';

export function createRstest(
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
     * When true, `runTests()` will not mutate `process.exitCode` or attach
     * process signal handlers. Set by the `@rstest/core/api` adapter.
     *
     * @internal
     */
    embedded?: boolean;
  },
  command: RstestCommand,
  fileFilters: string[],
  fileFilterMode?: FileFilterMode,
): RstestInstance {
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
