import fs from 'node:fs';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { SnapshotSummary } from '@vitest/snapshot';
import path from 'pathe';
import { type StackFrame, parse as stackTraceParse } from 'stacktrace-parser';
import { TEST_DELIMITER } from '../constants';
import type {
  Duration,
  GetSourcemap,
  TestFileResult,
  TestResult,
} from '../types';
import { color, getTaskNames, logger, prettyTime, slash } from '../utils';

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

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/node/reporters/renderers/utils.ts#L52
 */
export const formatTestPath = (root: string, testFilePath: string): string => {
  let testPath = testFilePath;
  if (path.isAbsolute(testPath)) {
    testPath = path.relative(root, testPath);
  }

  const dir = path.dirname(testPath);
  const ext = testPath.match(/(\.(spec|test)\.[cm]?[tj]sx?)$/)?.[0] || '';
  const base = path.basename(testPath, ext);

  return slash(color.dim(`${dir}/`) + color.bold(base)) + color.dim(ext);
};

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/e8ce94cfb5520a8b69f9071cc5638a53129130d6/packages/vitest/src/node/reporters/renderers/utils.ts#L67
 */
export const printSnapshotSummaryLog = (
  snapshots: SnapshotSummary,
  rootDir: string,
): void => {
  const summary: string[] = [];

  if (snapshots.added) {
    summary.push(color.bold(color.green(`${snapshots.added} written`)));
  }
  if (snapshots.unmatched) {
    summary.push(color.bold(color.red(`${snapshots.unmatched} failed`)));
  }
  if (snapshots.updated) {
    summary.push(color.bold(color.green(`${snapshots.updated} updated `)));
  }

  if (snapshots.filesRemoved) {
    if (snapshots.didUpdate) {
      summary.push(
        color.bold(color.green(`${snapshots.filesRemoved} files removed `)),
      );
    } else {
      summary.push(
        color.bold(color.yellow(`${snapshots.filesRemoved} files obsolete `)),
      );
    }
  }
  const F_DOWN_RIGHT = '↳';

  if (snapshots.filesRemovedList?.length) {
    const [head, ...tail] = snapshots.filesRemovedList;
    summary.push(
      `${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, head!)}`,
    );

    for (const key of tail) {
      summary.push(
        `  ${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, key)}`,
      );
    }
  }

  if (snapshots.unchecked) {
    if (snapshots.didUpdate) {
      summary.push(color.bold(color.green(`${snapshots.unchecked} removed`)));
    } else {
      summary.push(color.bold(color.yellow(`${snapshots.unchecked} obsolete`)));
    }

    for (const uncheckedFile of snapshots.uncheckedKeysByFile) {
      summary.push(
        `${color.gray(F_DOWN_RIGHT)} ${formatTestPath(rootDir, uncheckedFile.filePath)}`,
      );
      for (const key of uncheckedFile.keys) {
        summary.push(`  ${color.gray(F_DOWN_RIGHT)} ${key}`);
      }
    }
  }

  for (const [index, snapshot] of summary.entries()) {
    const title = index === 0 ? 'Snapshots' : '';
    logger.log(`${color.gray(title.padStart(12))} ${snapshot}`);
  }
};

export const printSummaryLog = ({
  results,
  testResults,
  snapshotSummary,
  duration,
  rootPath,
}: {
  results: TestFileResult[];
  testResults: TestResult[];
  snapshotSummary: SnapshotSummary;
  duration: Duration;
  rootPath: string;
}): void => {
  logger.log('');
  printSnapshotSummaryLog(snapshotSummary, rootPath);
  logger.log(
    `${color.gray('Test Files'.padStart(12))} ${getSummaryStatusString(results)}`,
  );
  logger.log(
    `${color.gray('Tests'.padStart(12))} ${getSummaryStatusString(testResults)}`,
  );

  logger.log(
    `${color.gray('Duration'.padStart(12))} ${prettyTime(duration.totalTime)} ${color.gray(`(build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)})`)}`,
  );
  logger.log('');
};

export const printSummaryErrorLogs = async ({
  testResults,
  results,
  rootPath,
  getSourcemap,
}: {
  rootPath: string;
  results: TestFileResult[];
  testResults: TestResult[];
  getSourcemap: GetSourcemap;
}): Promise<void> => {
  const failedTests: TestResult[] = [
    ...results.filter((i) => i.status === 'fail' && i.errors),
    ...testResults.filter((i) => i.status === 'fail'),
  ];

  if (failedTests.length === 0) {
    return;
  }

  logger.log('');
  logger.log(color.bold('Summary of all failing tests:'));
  logger.log('');

  for (const test of failedTests) {
    const relativePath = path.relative(rootPath, test.testPath);
    const names = getTaskNames(test);

    //  FAIL  tests/index.test.ts > suite name > test case name
    logger.log(
      `${color.bgRed(' FAIL ')} ${relativePath} ${names.length ? `${TEST_DELIMITER} ${names.join(` ${TEST_DELIMITER} `)}` : ''}`,
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
  /node_modules\/chai/,
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
        const sourcemap = getSourcemap(frame.file!);
        if (sourcemap) {
          const traceMap = new TraceMap(sourcemap);
          const { line, column, source, name } = originalPositionFor(traceMap, {
            line: frame.lineNumber!,
            column: frame.column!,
          });

          if (!source) {
            // some Rspack runtime wrapper code, should filter them out
            return null;
          }

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
  ).then((frames) =>
    frames.filter((frame): frame is StackFrame => frame !== null),
  );
}
