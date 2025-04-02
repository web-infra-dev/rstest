import fs from 'node:fs';
import { posix } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { type StackFrame, parse as stackTraceParse } from 'stacktrace-parser';
import type {
  Duration,
  GetSourcemap,
  TestFileResult,
  TestResult,
} from '../types';
import { color, logger, prettyTime } from '../utils';

export const getSummaryStatusString = (
  tasks: TestResult[],
  name = 'tests',
  showTotal = true,
): string => {
  if (tasks.length === 0) {
    return color.dim(`no ${name}`);
  }

  const passed = tasks.filter((result) => result.status === 'pass');
  const failed = tasks.filter((result) => result.status === 'fail');
  const skipped = tasks.filter((result) => result.status === 'skip');
  const todo = tasks.filter((result) => result.status === 'todo');

  return (
    [
      failed.length ? color.bold(color.red(`${failed.length} failed`)) : null,
      passed.length ? color.bold(color.green(`${passed.length} passed`)) : null,
      skipped.length ? color.yellow(`${skipped.length} skipped`) : null,
      todo.length ? color.gray(`${todo.length} todo`) : null,
    ]
      .filter(Boolean)
      .join(color.dim(' | ')) +
    (showTotal ? color.gray(` (${tasks.length})`) : '')
  );
};

export const printSummaryLog = (
  results: TestFileResult[],
  testResults: TestResult[],
  duration: Duration,
): void => {
  logger.log('');
  logger.log(
    `${color.gray('Test Files'.padStart(12))} ${getSummaryStatusString(results)}`,
  );
  logger.log(
    `${color.gray('Tests'.padStart(12))} ${getSummaryStatusString(testResults)}`,
  );

  logger.log(
    `${color.gray('Duration'.padStart(12))} ${prettyTime(duration.totalTime)} ${color.gray(`(build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)}`)})`,
  );
  logger.log('');
};

export const printSummaryErrorLogs = async ({
  testResults,
  rootPath,
  getSourcemap,
}: {
  rootPath: string;
  testResults: TestResult[];
  getSourcemap: GetSourcemap;
}): Promise<void> => {
  const failedTests = testResults.filter((i) => i.status === 'fail');

  if (failedTests.length === 0) {
    return;
  }

  logger.log('');
  logger.log(color.bold('Summary of all failing tests:'));
  logger.log('');

  for (const test of failedTests) {
    const relativePath = posix.relative(rootPath, test.testPath);
    logger.log(
      `${color.bgRed(' FAIL ')} ${relativePath} > ${test.prefix}${test.name}`,
    );

    if (test.errors) {
      for (const error of test.errors) {
        const errorName = error.name || 'Unknown Error';

        logger.log(
          `${color.red(color.bold(errorName))}${color.red(`: ${error.message}`)}\n`,
        );
        if (error.stack) {
          const stackFrames = await parseErrorStacktrace({
            stack: error.stack,
            getSourcemap,
          });

          if (stackFrames[0]) {
            await printCodeFrame(stackFrames[0]);
          }

          printStack(stackFrames);
        }
      }
    }
  }
};

async function printCodeFrame(frame: StackFrame) {
  const source = fs.readFileSync(frame.file!, 'utf-8');
  const { codeFrameColumns } = await import('@babel/code-frame');
  const result = codeFrameColumns(
    source,
    {
      start: {
        line: frame!.lineNumber!,
        column: frame!.column!,
      },
    },
    {
      highlightCode: true,
      linesBelow: 2,
    },
  );

  logger.log(result);
  logger.log('');
}

function printStack(stackFrames: StackFrame[]) {
  for (const frame of stackFrames) {
    logger.log(
      color.gray(
        `        at ${frame.methodName} (${frame.file}:${frame.lineNumber}:${frame.column})`,
      ),
    );
  }
  logger.log();
}

const stackIgnores: (RegExp | string)[] = [
  /\/@rstest\/core/,
  /rstest\/packages\/core\/dist/,
  /node_modules\/tinypool/,
];

function parseErrorStacktrace({
  stack,
  getSourcemap,
}: {
  stack: string;
  getSourcemap: GetSourcemap;
}): Promise<StackFrame[]> {
  return Promise.all(
    stackTraceParse(stack)
      .filter(
        (frame) =>
          frame.file && !stackIgnores.some((entry) => frame.file?.match(entry)),
      )
      .map(async (frame) => {
        const sourcemap = await getSourcemap(frame.file!);
        if (sourcemap) {
          const traceMap = new TraceMap(sourcemap);
          const { line, column, source, name } = originalPositionFor(traceMap, {
            line: frame.lineNumber!,
            column: frame.column!,
          });

          return {
            ...frame,
            file: source,
            lineNumber: line,
            name,
            column,
          };
        }
        return frame;
      }),
  );
}
