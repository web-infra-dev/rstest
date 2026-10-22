import { readFile, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'chokidar';
import { normalize } from 'pathe';
import type {
  ExecutorCycleOutcome,
  ExecutorInvalidationCallback,
  SerializedError,
  TestExecutor,
  TestInfo,
  TestResult,
} from '../../types';
import { logger, toError, getFileTaskId } from '../../utils';
import type { Rstest } from '../rstest';
import { createRunnerEventSink } from '../execution/runnerEventSink';
import { collectTypeTests, type TypeTestFile } from './collect';
import { createTypeChecker } from './checker';
import type { TypecheckProject } from './plan';

export function createTypecheckExecutor(
  context: Rstest,
  initialPlans: TypecheckProject[],
  discover: (fileFilters?: string[]) => Promise<TypecheckProject[]>,
): TestExecutor {
  const projects = initialPlans.map(({ project }) => project);
  const checkers = new Map<string, ReturnType<typeof createTypeChecker>>();
  const watchers: FSWatcher[] = [];
  let sourceWatcher: FSWatcher | undefined;
  let dependencyWatcher: FSWatcher | undefined;
  let invalidated: ExecutorInvalidationCallback | undefined;
  let closed = false;
  let revision = 0;
  let previousPaths = initialPlans.flatMap(({ testPaths }) => testPaths);
  const changed = () => {
    revision++;
    if (!closed && invalidated) {
      Promise.resolve(invalidated({ isFirstBuild: false })).catch((error) =>
        logger.error(toError(error)),
      );
    }
  };
  const close = async () => {
    closed = true;
    await Promise.all([
      ...watchers.map((watcher) => watcher.close()),
      ...[...checkers.values()].map((checker) => checker.close()),
    ]);
  };
  return {
    name: 'typecheck',
    projects,
    async init() {
      if (context.command !== 'watch') return;
      const watcher = watch(
        projects.map((project) => project.normalizedConfig.root),
        {
          ignoreInitial: true,
          ignored:
            /(?:^|[/\\])(?:node_modules|\.git|dist|\.rstest|\.rstest-reports)(?:[/\\]|$)/,
        },
      );
      sourceWatcher = watcher;
      dependencyWatcher = watch([], { ignoreInitial: true });
      watchers.push(watcher, dependencyWatcher);
      watcher.on('all', (_event, file) => {
        // Custom JSON report files must not trigger the run that writes them.
        // Imported JSON and extended configs are watched explicitly below.
        if (
          /\.(?:[cm]?[jt]sx?|vue)$/.test(file) ||
          /(?:^|[/\\])(?:tsconfig[^/\\]*\.json|package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(
            file,
          )
        )
          changed();
      });
      dependencyWatcher.on('all', changed);
      await new Promise<void>((resolve, reject) => {
        watcher.once('ready', resolve);
        watcher.once('error', reject);
      });
    },
    onInvalidate(callback) {
      invalidated = callback;
    },
    async collect() {
      return {
        list: await Promise.all(
          initialPlans.flatMap(({ project, testPaths }) =>
            testPaths.map(async (testPath) => {
              const { tests, errors } = await collectTypeTests(
                testPath,
                project,
              );
              return { testPath, project: project.name, tests, errors };
            }),
          ),
        ),
      };
    },
    async runCycle(options) {
      const started = performance.now();
      const outcome: ExecutorCycleOutcome = {
        results: [],
        testResults: [],
        errors: [],
        testPaths: [],
        duration: { buildTime: 0, testTime: 0 },
      };
      const plans = await discover(options.fileFilters ?? context.fileFilters);
      const nextPaths = plans.flatMap(({ testPaths }) => testPaths);
      outcome.deletedTestPaths = (
        await Promise.all(
          previousPaths.map(async (file) => {
            try {
              await stat(file);
              return undefined;
            } catch {
              return file;
            }
          }),
        )
      ).filter((file): file is string => file !== undefined);
      previousPaths = [...new Set([...previousPaths, ...nextPaths])].filter(
        (file) => !outcome.deletedTestPaths!.includes(file),
      );
      for (const { project, testPaths } of plans) {
        if (closed || !testPaths.length) continue;
        try {
          let checker = checkers.get(project.environmentName);
          if (!checker) {
            checker = createTypeChecker(project);
            checkers.set(project.environmentName, checker);
          }
          let files: TypeTestFile[];
          let diagnostics: Awaited<ReturnType<typeof checker.check>>;
          for (;;) {
            const { files: dependencies, directories } =
              await checker.prepare(testPaths);
            dependencyWatcher?.add(dependencies);
            sourceWatcher?.add(directories);
            const before = revision;
            const stamps = async () =>
              Promise.all(
                dependencies.map(async (file) => {
                  try {
                    const info = await stat(file);
                    return `${info.mtimeMs}:${info.size}`;
                  } catch {
                    return 'missing';
                  }
                }),
              );
            const versions = await stamps();
            files = await Promise.all(
              testPaths.map((testPath) => collectTypeTests(testPath, project)),
            );
            diagnostics = await checker.check();
            const current = await stamps();
            const sources = await Promise.all(
              files.map((file) => readFile(file.testPath, 'utf8')),
            );
            if (
              before === revision &&
              versions.every((value, index) => value === current[index]) &&
              files.every((file, index) => file.source === sources[index])
            )
              break;
            if (closed) return outcome;
          }
          const sink = createRunnerEventSink(context, project.normalizedConfig);
          const errorsByCase = new Map<string, SerializedError[]>();
          const pattern =
            context.normalizedConfig.testNamePattern ??
            project.normalizedConfig.testNamePattern;
          const matches = (test: TestInfo) => {
            if (!pattern) return true;
            const regex =
              typeof pattern === 'string'
                ? new RegExp(pattern)
                : new RegExp(pattern.source, pattern.flags);
            return regex.test(
              [...(test.parentNames ?? []), test.name].join(' '),
            );
          };
          for (const diagnostic of diagnostics) {
            const file = files.find(
              (file) => normalize(file.testPath) === diagnostic.file,
            );
            if (
              !file ||
              diagnostic.line === undefined ||
              diagnostic.column === undefined
            ) {
              const error = new Error(diagnostic.error.message);
              error.name = diagnostic.error.name ?? 'TypecheckError';
              error.stack = diagnostic.error.stack;
              outcome.errors.push(error);
              continue;
            }
            const lines = file.source.split('\n');
            const offset =
              lines
                .slice(0, diagnostic.line - 1)
                .reduce((sum, line) => sum + line.length + 1, 0) +
              diagnostic.column -
              1;
            const owner = file.ranges
              .filter((range) => range.start <= offset && range.end > offset)
              .sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.test;
            if (owner?.type === 'case' && matches(owner)) {
              const errors = errorsByCase.get(owner.testId) ?? [];
              errors.push(diagnostic.error);
              errorsByCase.set(owner.testId, errors);
            } else file.errors.push(diagnostic.error);
          }
          for (const file of files) {
            if (closed) return outcome;
            const fileInfo = {
              testId: getFileTaskId(file.testPath),
              testPath: file.testPath,
              project: project.name,
              tests: file.tests,
            };
            await sink.onTestFileStart(fileInfo);
            await sink.onTestFileReady(fileInfo);
            const results: TestResult[] = [];
            const report = async (test: TestInfo): Promise<void> => {
              if (test.type === 'suite') {
                await sink.onTestSuiteStart(test);
                const start = results.length;
                for (const child of test.tests) await report(child);
                await sink.onTestSuiteResult({
                  ...test,
                  status: results
                    .slice(start)
                    .some((result) => result.status === 'fail')
                    ? 'fail'
                    : 'pass',
                });
                return;
              }
              const errors = errorsByCase.get(test.testId);
              const result: TestResult = {
                ...test,
                status: !matches(test)
                  ? 'skip'
                  : errors?.length
                    ? 'fail'
                    : 'pass',
                errors,
              };
              if (result.status !== 'skip') sink.onTestCaseStart(test);
              await sink.onTestCaseResult(result);
              results.push(result);
            };
            for (const test of file.tests) await report(test);
            const result = {
              ...fileInfo,
              name: '[typecheck]',
              meta: {
                typecheck: true,
                checker: project.normalizedConfig.typecheck.checker,
                checkerVersion: checker.version,
              },
              results,
              status:
                file.errors.length ||
                results.some((result) => result.status === 'fail')
                  ? ('fail' as const)
                  : ('pass' as const),
              errors: file.errors,
            };
            await sink.onTestFileResult(result);
            outcome.results.push(result);
            outcome.testResults.push(...results);
            outcome.testPaths.push(file.testPath);
          }
        } catch (error) {
          if (!closed) outcome.errors.push(toError(error));
        }
      }
      outcome.duration.testTime = performance.now() - started;
      return outcome;
    },
    interrupt: close,
    close,
  };
}
