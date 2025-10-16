import fs from 'node:fs';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { type StackFrame, parse as stackTraceParse } from 'stacktrace-parser';
import type { FormattedError, GetSourcemap } from '../types';
import { color, formatTestPath, globalApis, isDebug, logger } from '../utils';

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

  if (error.message.includes('is not defined')) {
    const [, varName] = error.message.match(/(.*) is not defined/) || [];
    if (varName) {
      if ((globalApis as string[]).includes(varName)) {
        error.message = error.message.replace(
          `${varName} is not defined`,
          `${varName} is not defined. Did you forget to enable "globals" configuration?`,
        );
      } else if (['jest', 'vitest'].includes(varName)) {
        error.message = error.message.replace(
          `${varName} is not defined`,
          `${varName} is not defined. Did you mean rstest?`,
        );
      }
    }
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
      fullStack: error.fullStack,
      getSourcemap,
    });

    if (!stackFrames.length && error.stack.length) {
      logger.log(
        color.gray(
          "No error stack found, set 'DEBUG=rstest' to show fullStack.",
        ),
      );
    }

    if (stackFrames[0]) {
      await printCodeFrame(stackFrames[0]);
    }

    printStack(stackFrames, rootPath);
  }
}

async function printCodeFrame(frame: StackFrame) {
  const filePath = frame.file?.startsWith('file')
    ? new URL(frame.file)
    : frame.file;

  if (!filePath) {
    return;
  }

  const source = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8')
    : undefined;

  if (!source) {
    return;
  }
  const { codeFrameColumns } = await import('@babel/code-frame');
  const result = codeFrameColumns(
    source,
    {
      start: {
        line: frame.lineNumber!,
        column: frame.column!,
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

export function formatStack(frame: StackFrame, rootPath: string): string {
  return frame.methodName !== '<unknown>'
    ? `at ${frame.methodName} (${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column})`
    : `at ${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column}`;
}

function printStack(stackFrames: StackFrame[], rootPath: string) {
  for (const frame of stackFrames) {
    logger.log(color.gray(`        ${formatStack(frame, rootPath)}`));
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
  /webpack\/runtime/,
  // windows path
  /webpack\\runtime/,
  '<anonymous>',
];

export async function parseErrorStacktrace({
  stack,
  getSourcemap,
  fullStack = isDebug(),
}: {
  fullStack?: boolean;
  stack: string;
  getSourcemap: GetSourcemap;
}): Promise<StackFrame[]> {
  const stackFrames = await Promise.all(
    stackTraceParse(stack)
      .filter((frame) =>
        fullStack
          ? true
          : frame.file &&
            !stackIgnores.some((entry) => frame.file?.match(entry)),
      )
      .map(async (frame) => {
        const sourcemap = await getSourcemap(frame.file!);
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

  return stackFrames;
}
