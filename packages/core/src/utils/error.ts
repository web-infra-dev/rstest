import fs from 'node:fs';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { type StackFrame, parse as stackTraceParse } from 'stacktrace-parser';
import type { FormattedError, GetSourcemap } from '../types';
import { color, formatTestPath, logger } from '../utils';

export async function printError(
  error: FormattedError,
  getSourcemap: GetSourcemap,
  rootPath: string,
): Promise<void> {
  const errorName = error.name || 'Unknown Error';

  if (error.message.includes('Vitest failed to access its internal state')) {
    const tips = [
      'Error: not support import `vitest` in Rstest test environment.\n',
      'Solution:',
      `  - Update your code to use imports from "${color.yellow('@rstest/core')}" instead of "${color.yellow('vitest')}".`,
      '  - Enable `globals` configuration and use global API.',
    ];

    logger.log(`${color.red(tips.join('\n'))}\n`);
    return;
  }
  logger.log(
    `${color.red(color.bold(errorName))}${color.red(`: ${error.message}`)}\n`,
  );

  if (error.diff) {
    logger.log(error.diff);
    logger.log();
  }

  if (error.stack) {
    const stackFrames = await parseErrorStacktrace({
      stack: error.stack,
      getSourcemap,
    });

    if (stackFrames[0]) {
      await printCodeFrame(stackFrames[0]);
    }

    printStack(stackFrames, rootPath);
  }
}

async function printCodeFrame(frame: StackFrame) {
  const filePath = frame.file?.startsWith('file')
    ? new URL(frame.file!)
    : frame.file;

  if (!filePath) {
    return;
  }

  const source = fs.existsSync(filePath)
    ? fs.readFileSync(filePath!, 'utf-8')
    : undefined;

  if (!source) {
    return;
  }
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

function printStack(stackFrames: StackFrame[], rootPath: string) {
  for (const frame of stackFrames) {
    const msg =
      frame.methodName !== '<unknown>'
        ? `at ${frame.methodName} (${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column})`
        : `at ${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column}`;
    logger.log(color.gray(`        ${msg}`));
  }
  stackFrames.length && logger.log();
}

const stackIgnores: (RegExp | string)[] = [
  /\/@rstest\/core/,
  /rstest\/packages\/core\/dist/,
  /node_modules\/tinypool/,
  /node_modules\/chai/,
  /node_modules\/@vitest\/expect/,
  /node_modules\/@vitest\/snapshot/,
  /node:\w+/,
  '<anonymous>',
];

async function parseErrorStacktrace({
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
        // &&
        // frame.methodName !== 'webpackEmptyContext',
      )
      .map(async (frame) => {
        // console.log('frame', frame);
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
          console.log('frame', source);
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
