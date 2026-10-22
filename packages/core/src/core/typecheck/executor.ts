import { readFile } from 'node:fs/promises';
import { normalize } from 'pathe';
import type {
  ExecutorCycleOutcome,
  SerializedError,
  TestExecutor,
  TestInfo,
  TestResult,
} from '../../types';
import { toError, getFileTaskId } from '../../utils';
import type { Rstest } from '../rstest';
import { createRunnerEventSink } from '../execution/runnerEventSink';
import { collectTypeTests } from './collect';
import { createTypeChecker } from './checker';
import type { TypecheckProject } from './plan';

export function createTypecheckExecutor(
  context: Rstest,
  initialPlans: TypecheckProject[],
): TestExecutor {
  const projects = initialPlans.map(({ project }) => project);
  const checkers = new Map<string, ReturnType<typeof createTypeChecker>>();
  let closed = false;
  const close = async () => {
    closed = true;
    await Promise.all([
      ...[...checkers.values()].map((checker) => checker.close()),
    ]);
  };
  return {
    name: 'typecheck',
    projects,
    async init() {},
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
    async runCycle() {
      const started = performance.now();
      const outcome: ExecutorCycleOutcome = {
        results: [],
        testResults: [],
        errors: [],
        testPaths: [],
        duration: { buildTime: 0, testTime: 0 },
      };
      for (const { project, testPaths } of initialPlans) {
        if (closed || !testPaths.length) continue;
        try {
          let checker = checkers.get(project.environmentName);
          if (!checker) {
            checker = createTypeChecker(project);
            checkers.set(project.environmentName, checker);
          }
          const [files, diagnostics] = await Promise.all([
            Promise.all(
              testPaths.map((testPath) => collectTypeTests(testPath, project)),
            ),
            checker.check(testPaths),
          ]);
          const sources = await Promise.all(
            files.map((file) => readFile(file.testPath, 'utf8')),
          );
          if (files.some((file, index) => file.source !== sources[index]))
            throw new Error(
              'Type test files changed during checking. Run the tests again.',
            );
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
