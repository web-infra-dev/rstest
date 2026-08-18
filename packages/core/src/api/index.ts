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
import { resolveRunnerInputs } from '../core/resolveConfig';
import type { RstestConfig, TestInfo } from '../types';
import {
  getAbsolutePath,
  getTaskNameWithPrefix,
  ROOT_SUITE_NAME,
} from '../utils';
import { createErrorResult, createResultReporter } from './result';
import { createProgrammaticRunner } from './runner';
import type {
  CreateRstestOptions,
  CreateRunnerOptions,
  ListedTest,
  ListOptions,
  MergeReportsOptions,
  RstestInstance,
  RstestInstanceContext,
  RunOptions,
  TestRunResult,
  WatchOptions,
} from './types';

export { runCLI, type RunCLIOptions } from '../cli';
export type * from './types';

const toShardOption = (
  shard: CreateRunnerOptions['shard'],
): string | undefined =>
  typeof shard === 'string'
    ? shard
    : shard
      ? `${shard.index}/${shard.count}`
      : undefined;

const toCommonOptions = (options: RunOptions = {}): CommonOptions => ({
  related: options.related,
  changed: options.changed,
  shard: toShardOption(options.shard),
  project: options.project,
  testNamePattern: options.testNamePattern,
  update: options.update,
  bail: options.bail,
  passWithNoTests: options.passWithNoTests,
});

const applySnapshotUpdateOption = (
  context: ReturnType<typeof createRstestContext>['context'],
  update: boolean | undefined,
): void => {
  if (update === false) {
    context.snapshotManager.options.updateSnapshot = 'none';
  }
};

const flattenListedTests = (
  files: Awaited<
    ReturnType<ReturnType<typeof createRstestContext>['listTests']>
  >,
  options: ListOptions,
  showProject: boolean,
): ListedTest[] => {
  if (options.filesOnly) {
    return files.map((file) => ({
      file: file.testPath,
      project: showProject ? file.project : undefined,
      type: 'file',
    }));
  }

  const listed: ListedTest[] = [];
  const visit = (test: TestInfo, parentNames: string[]): void => {
    if (
      test.type === 'case' ||
      (options.includeSuites &&
        test.type === 'suite' &&
        test.name !== ROOT_SUITE_NAME)
    ) {
      // Structured consumers need skipped declarations to build a complete
      // test tree. The CLI renderer deliberately continues to omit them.
      listed.push({
        file: test.testPath,
        name: getTaskNameWithPrefix(test),
        taskName: test.name,
        parentNames,
        project: showProject ? test.project : undefined,
        location: test.location,
        runMode:
          test.runMode === 'skip' || test.runMode === 'todo'
            ? test.runMode
            : undefined,
        type: test.type,
      });
    }
    if (test.type === 'suite') {
      const childParentNames =
        test.name === ROOT_SUITE_NAME
          ? parentNames
          : [...parentNames, test.name];
      test.tests.forEach((child) => visit(child, childParentNames));
    }
  };

  for (const file of files) {
    file.tests.forEach((test) => visit(test, []));
  }
  return listed;
};

/**
 * Create a reusable Rstest instance.
 *
 * The configuration is resolved during creation. Each operation resolves it
 * again so configuration factories and mutable external inputs are observed.
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
  const loadConfigValue = async (): Promise<RstestConfig> =>
    typeof options.config === 'function'
      ? await options.config()
      : (options.config ?? {});
  const resolve = async (commonOptions: CommonOptions) =>
    resolveRunnerInputs({
      source: { type: 'value', config: await loadConfigValue() },
      options: commonOptions,
      cwd,
    });

  const initialInputs = await resolve({});
  const initialContext = createRstestContext(
    {
      config: initialInputs.config,
      configFilePath: initialInputs.configFilePath,
      projects: initialInputs.projects,
      cwd,
      embedded: true,
    },
    'run',
    undefined,
  ).context;
  const context: RstestInstanceContext = {
    version: initialContext.version,
    root: initialContext.rootPath,
    config: initialContext.normalizedConfig,
    projects: initialInputs.projects.length
      ? initialContext.projects.map((project) => ({
          name: project.name,
          root: project.rootPath,
          configFilePath: project.configFilePath,
        }))
      : [],
  };

  const build = async (
    command: 'run' | 'watch' | 'list' | 'merge-reports',
    runOptions: RunOptions,
    commonOptions = toCommonOptions(runOptions),
  ) =>
    buildResolvedRunner({
      inputs: await resolve(commonOptions),
      options: commonOptions,
      command,
      filters: runOptions.filters,
      filterMode: runOptions.filterMode,
      createRstestContext: createRstestContext satisfies CreateRstestContextFn,
      embedded: true,
    });

  return {
    context,

    async run(runOptions: RunOptions = {}): Promise<TestRunResult> {
      let capture: ReturnType<typeof createResultReporter> | undefined;
      let engine: Awaited<ReturnType<typeof build>> | undefined;
      try {
        engine = await build('run', runOptions);
        applySnapshotUpdateOption(engine.context, runOptions.update);
        capture = createResultReporter(engine.context);
        engine.context.reporters.push(capture.reporter);
        const result = capture.nextResult();
        await engine.runTests();
        return await result;
      } catch (error) {
        return capture?.errorResult(error) ?? createErrorResult(error);
      } finally {
        capture?.dispose();
      }
    },

    async createRunner(runnerOptions: CreateRunnerOptions = {}) {
      const engine = await build('run', runnerOptions);
      if (
        engine.context.projects.some(
          (project) => project.normalizedConfig.browser.enabled,
        )
      ) {
        throw new Error(
          'createRunner() does not support browser mode. Use run() instead.',
        );
      }
      return createProgrammaticRunner(engine.context);
    },

    async watch(watchOptions: WatchOptions & RunOptions = {}) {
      const commonOptions = toCommonOptions(watchOptions);
      if (isRelatedRun(commonOptions)) {
        throw new Error(
          'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
        );
      }
      const engine = await build('watch', watchOptions, commonOptions);
      if (
        engine.context.projects.some(
          (project) => project.normalizedConfig.browser.enabled,
        )
      ) {
        throw new Error(
          'watch() does not support browser mode yet. Use run() instead.',
        );
      }
      const capture = createResultReporter(engine.context, {
        onResult: watchOptions.onResult,
        allowEmpty: true,
      });
      applySnapshotUpdateOption(engine.context, watchOptions.update);
      engine.context.reporters.push(capture.reporter);
      const initialResult = capture.nextResult();
      try {
        await engine.runTests();
        await initialResult;
      } catch (error) {
        capture.dispose();
        throw error;
      }

      const closeWatchSession = engine.context.closeWatchSession;
      let closePromise: Promise<void> | undefined;
      return {
        close(): Promise<void> {
          if (!closePromise) {
            closePromise = (async () => {
              try {
                await closeWatchSession?.();
              } finally {
                capture.dispose();
              }
            })();
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
        includeTaskLocation: listOptions.printLocation,
      };
      const engine = await build(
        'list',
        { ...listOptions, shard: undefined },
        commonOptions,
      );
      const showProject = engine.context.projects.length > 1;
      const files = await engine.listTests({
        filesOnly: listOptions.filesOnly,
        includeSuites: listOptions.includeSuites,
        printLocation: listOptions.printLocation,
      });
      if (engine.context.exitCode.current !== 0) {
        throw new Error('Failed to list tests.');
      }
      return flattenListedTests(files, listOptions, showProject);
    },

    async mergeReports(
      mergeOptions: MergeReportsOptions = {},
    ): Promise<TestRunResult> {
      let capture: ReturnType<typeof createResultReporter> | undefined;
      try {
        const engine = await build('merge-reports', {}, {});
        capture = createResultReporter(engine.context, { allowEmpty: true });
        engine.context.reporters.push(capture.reporter);
        const result = capture.nextResult();
        await engine.mergeReports(mergeOptions);
        return await result;
      } catch (error) {
        return capture?.errorResult(error) ?? createErrorResult(error);
      } finally {
        capture?.dispose();
      }
    },
  };
}
