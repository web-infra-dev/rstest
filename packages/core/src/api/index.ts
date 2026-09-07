/**
 * Programmatic Node API for running Rstest in-process.
 *
 * @experimental
 * All exports from this entrypoint are subject to change until 1.0.0.
 */
import type { CommonOptions } from '../cli/init';
import { initRstestEnv } from '../cli/prepare';
import {
  buildResolvedRunner,
  type CreateRstestContextFn,
  isRelatedRun,
} from '../core/buildRunner';
import { createRstest as createRstestContext } from '../core';
import {
  resolveRunnerInputs,
  resolveRunnerOperationInputs,
} from '../core/resolveConfig';
import { exitReporters } from '../reporter';
import type {
  InternalContext,
  ListCommandResult,
  RstestConfig,
  TestInfo,
} from '../types';
import {
  getAbsolutePath,
  getTaskNameWithPrefix,
  ROOT_SUITE_NAME,
} from '../utils';
import {
  createErrorResult,
  createResultReporter,
  type ResultReporter,
} from './result';
import type {
  CreateRstestOptions,
  ListedTest,
  ListOptions,
  LoadedRstestConfig,
  MergeReportsOptions,
  RstestContext,
  RstestInstance,
  RunOptions,
  TestRunResult,
  WatchOptions,
} from './types';

export { runCLI, type RunCLIOptions } from '../cli';
export type * from './types';

const toShardOption = (shard: RunOptions['shard']): string | undefined =>
  typeof shard === 'string'
    ? shard
    : shard
      ? `${shard.index}/${shard.count}`
      : undefined;

const toCommonOptions = ({
  filters: _filters,
  filterMode: _filterMode,
  shard,
  ...common
}: RunOptions = {}): CommonOptions => ({
  ...common,
  shard: toShardOption(shard),
});

const listedRunModes = {
  run: undefined,
  skip: 'skip',
  todo: 'todo',
  only: undefined,
} satisfies Record<TestInfo['runMode'], ListedTest['runMode']>;

const applySnapshotUpdateOption = (
  context: InternalContext,
  update: boolean | undefined,
): void => {
  if (update === false) {
    context.snapshotManager.options.updateSnapshot = 'none';
  }
};

const flattenListedTests = (
  files: ListCommandResult[],
  options: ListOptions,
): ListedTest[] => {
  if (options.filesOnly) {
    return files.map((file) => ({
      testPath: file.testPath,
      project: file.project,
      type: 'file',
    }));
  }

  const listed: ListedTest[] = [];
  const visit = (test: TestInfo): void => {
    if (
      test.type === 'case' ||
      (options.includeSuites &&
        test.type === 'suite' &&
        test.name !== ROOT_SUITE_NAME)
    ) {
      // Structured consumers need skipped declarations to build a complete
      // test tree. The CLI renderer deliberately continues to omit them.
      listed.push({
        testPath: test.testPath,
        name: test.name,
        fullName: getTaskNameWithPrefix(test),
        parentNames: test.parentNames ?? [],
        project: test.project,
        location: test.location,
        runMode: listedRunModes[test.runMode],
        type: test.type,
      });
    }
    if (test.type === 'suite') {
      test.tests.forEach(visit);
    }
  };

  for (const file of files) {
    file.tests.forEach(visit);
  }
  return listed;
};

const isLoadedRstestConfig = (
  config: RstestConfig | LoadedRstestConfig,
): config is LoadedRstestConfig => 'content' in config && 'filePath' in config;

/**
 * Create a reusable Rstest instance.
 *
 * The configuration is resolved during creation and reused as the instance's
 * base configuration. Operation options are applied without mutating it.
 *
 * @experimental Subject to change until 1.0.0.
 */
export async function createRstest(
  options: CreateRstestOptions = {},
): Promise<RstestInstance> {
  initRstestEnv();
  const cwd = options.cwd
    ? getAbsolutePath(process.cwd(), options.cwd)
    : process.cwd();
  const config = options.config ?? {};
  const initialInputs = await resolveRunnerInputs({
    source: {
      type: 'value',
      config: isLoadedRstestConfig(config) ? config.content : config,
      configFilePath:
        isLoadedRstestConfig(config) && config.filePath !== null
          ? getAbsolutePath(cwd, config.filePath)
          : undefined,
    },
    options: {},
    cwd,
  });
  const initialContext = createRstestContext(
    {
      config: initialInputs.config,
      configFilePath: initialInputs.configFilePath,
      projects: initialInputs.projects,
      cwd,
      embedded: true,
      initializeReporters: false,
    },
    'run',
    undefined,
  ).context;
  const context: RstestContext = {
    version: initialContext.version,
    rootPath: initialContext.rootPath,
    config: initialContext.normalizedConfig,
    projects: initialContext.projects.map((project) => ({
      name: project.name,
      rootPath: project.rootPath,
      configFilePath: project.configFilePath,
    })),
  };

  const build = async (
    command: 'run' | 'watch' | 'list' | 'merge-reports',
    runOptions: RunOptions,
    commonOptions = toCommonOptions(runOptions),
  ) =>
    buildResolvedRunner({
      inputs: resolveRunnerOperationInputs({
        inputs: initialInputs,
        options: commonOptions,
      }),
      options: commonOptions,
      command,
      filters: runOptions.filters,
      filterMode: runOptions.filterMode,
      createRstestContext: createRstestContext satisfies CreateRstestContextFn,
      embedded: true,
    });

  type Engine = Awaited<ReturnType<typeof build>>;
  const withEngine = async <Result>(
    command: 'run' | 'list' | 'merge-reports',
    runOptions: RunOptions,
    commonOptions: CommonOptions | undefined,
    operation: (engine: Engine) => Promise<Result>,
  ): Promise<Result> => {
    let engine: Engine | undefined;
    try {
      engine = await build(command, runOptions, commonOptions);
      return await operation(engine);
    } finally {
      if (engine) {
        await exitReporters(engine.context);
      }
    }
  };
  const withCapturedResult = async (
    command: 'run' | 'merge-reports',
    runOptions: RunOptions,
    commonOptions: CommonOptions | undefined,
    operation: (engine: Engine) => Promise<void>,
  ): Promise<TestRunResult> => {
    try {
      return await withEngine(
        command,
        runOptions,
        commonOptions,
        async (engine) => {
          const capture: ResultReporter = createResultReporter(engine.context);
          engine.context.reporters.push(capture.reporter);
          const result = capture.nextResult();
          try {
            await operation(engine);
            return await result;
          } catch (error) {
            return capture.errorResult(error);
          }
        },
      );
    } catch (error) {
      return createErrorResult(error);
    }
  };

  return {
    context,

    async run(runOptions: RunOptions = {}): Promise<TestRunResult> {
      return withCapturedResult(
        'run',
        runOptions,
        undefined,
        async (engine) => {
          applySnapshotUpdateOption(engine.context, runOptions.update);
          await engine.runTests();
        },
      );
    },

    async watch(watchOptions: WatchOptions & RunOptions = {}) {
      const commonOptions = toCommonOptions(watchOptions);
      if (isRelatedRun(commonOptions)) {
        throw new Error(
          'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
        );
      }
      const engine = await build('watch', watchOptions, commonOptions);
      let capture: ResultReporter;
      try {
        if (
          engine.context.projects.some(
            (project) => project.normalizedConfig.browser.enabled,
          )
        ) {
          throw new Error(
            'watch() does not support browser mode yet. Use run() instead.',
          );
        }
        capture = createResultReporter(engine.context, {
          onResult: watchOptions.onResult,
        });
        engine.context.reporters.push(capture.reporter);
        applySnapshotUpdateOption(engine.context, watchOptions.update);
        const initialResult = capture.nextResult();
        await engine.runTests();
        await initialResult;
      } catch (error) {
        await exitReporters(engine.context);
        throw error;
      }

      const closeWatchSession = engine.context.closeWatchSession;
      let closePromise: Promise<void> | undefined;
      return {
        close(): Promise<void> {
          if (!closePromise) {
            closePromise =
              closeWatchSession?.() ?? exitReporters(engine.context);
          }
          return closePromise;
        },
      };
    },

    async listTests(
      listOptions: ListOptions & RunOptions = {},
    ): Promise<ListedTest[]> {
      const commonOptions = {
        ...toCommonOptions(listOptions),
        shard: undefined,
        includeTaskLocation: listOptions.includeLocation,
      };
      return withEngine(
        'list',
        { ...listOptions, shard: undefined },
        commonOptions,
        async (engine) => {
          const files = await engine.listTests({
            ...listOptions,
            printLocation: listOptions.includeLocation,
          });
          if (engine.context.exitCode.current !== 0) {
            throw new Error('Failed to list tests.');
          }
          return flattenListedTests(files, listOptions);
        },
      );
    },

    async mergeReports(
      mergeOptions: MergeReportsOptions = {},
    ): Promise<TestRunResult> {
      return withCapturedResult('merge-reports', {}, {}, async (engine) => {
        await engine.mergeReports(mergeOptions);
      });
    },
  };
}
