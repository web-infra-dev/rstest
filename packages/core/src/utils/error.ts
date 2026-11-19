import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import type { Colors } from 'picocolors/types';
import { type StackFrame, parse as stackTraceParse } from 'stacktrace-parser';
import type { SerializedError, GetSourcemap } from '../types';
import { type CodeFrameWindow, generateCodeFrame } from './codeFrame';
import { globalApis } from './constants';
import { color, isDebug, logger } from './logger';
import { formatTestPath } from './testFiles';

const serializeError = (
  error: unknown,
  ancestors: ReadonlySet<object>,
): SerializedError => {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }
  const value = error as Partial<SerializedError>;
  const serialized: SerializedError = {
    name: value.name,
    message: value.message ?? String(error),
    stack: typeof value.stack === 'string' ? value.stack : undefined,
    diff: value.diff,
    actual: value.actual,
    expected: value.expected,
    retryCount: value.retryCount,
    fullStack: value.fullStack,
  };
  // Keep the cause chain. `ancestors` stops a circular chain.
  try {
    const cause: unknown = value.cause;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      !Array.isArray(cause) &&
      typeof (cause as { message?: unknown }).message === 'string' &&
      cause !== error &&
      !ancestors.has(cause)
    ) {
      serialized.cause = serializeError(cause, new Set(ancestors).add(error));
    }
  } catch {
    // A getter on the cause can throw while it is read. The error is still
    // reported, without its cause.
  }
  return serialized;
};

// Takes one argument only, so it is safe to pass straight to `Array#map`.
export const toSerializedError = (error: unknown): SerializedError =>
  serializeError(error, new Set());

const isRelativePath = (p: string): boolean => /^\.\.?\//.test(p);

const isHttpLikeFile = (file: string): boolean => /^https?:\/\//.test(file);

const hintNotDefinedError = (message: string): string => {
  const [, varName] = /(\w+) is not defined/.exec(message) || [];
  if (varName) {
    if ((globalApis as readonly string[]).includes(varName)) {
      return message.replace(
        `${varName} is not defined`,
        `${varName} is not defined. Did you forget to enable "globals" configuration?`,
      );
    }
    if (['jest', 'vitest'].includes(varName)) {
      return message.replace(
        `${varName} is not defined`,
        `${varName} is not defined. Did you mean rstest?`,
      );
    }
    if (varName === 'React') {
      return message.replace(
        `${varName} is not defined`,
        `${varName} is not defined. Did you forget to install "${color.yellow('@rsbuild/plugin-react')}" plugin?`,
      );
    }
  }
  return message;
};

export async function printError(
  error: SerializedError,
  getSourcemap: GetSourcemap,
  rootPath: string,
): Promise<void> {
  let current: SerializedError | undefined = error;
  let label = '';
  while (current) {
    await printErrorWithoutCause(current, getSourcemap, rootPath, label);
    current = current.cause;
    label = 'Caused by: ';
  }
}

async function printErrorWithoutCause(
  error: SerializedError,
  getSourcemap: GetSourcemap,
  rootPath: string,
  label: string,
): Promise<void> {
  const errorName = error.name || 'Unknown Error';

  if (error.message.includes('Vitest failed to access its internal state')) {
    const tips = [
      `${label}Error: not support import \`vitest\` in Rstest test environment.\n`,
      'Solution:',
      `  - Update your code to use imports from "${color.yellow('@rstest/core')}" instead of "${color.yellow('vitest')}".`,
      '  - Enable `globals` configuration and use global API.',
    ];

    logger.stderr(`${color.red(tips.join('\n'))}\n`);
    return;
  }

  if (error.message.includes('is not defined')) {
    error.message = hintNotDefinedError(error.message);
  }

  logger.stderr(
    `${color.red(label)}${color.red(color.bold(errorName))}${color.red(`: ${error.message}`)}\n`,
  );

  if (error.diff) {
    logger.stderr(error.diff);
    logger.stderr('');
  }

  if (error.stack) {
    let stackFrames = await parseErrorStacktrace({
      stack: error.stack,
      fullStack: error.fullStack,
      getSourcemap,
    });
    if (
      !stackFrames.length &&
      !(error.fullStack || isDebug()) &&
      !error.stack.endsWith(error.message)
    ) {
      const fullStackFrames = await parseErrorStacktrace({
        stack: error.stack,
        fullStack: true,
        getSourcemap,
      });

      const printableFullStackFrames = fullStackFrames.filter(
        (frame) => frame.file,
      );

      if (printableFullStackFrames[0]) {
        stackFrames = printableFullStackFrames;
      } else {
        logger.stderr(
          color.gray(
            "No error stack found, set 'DEBUG=rstest' to show fullStack.",
          ),
        );
      }
    }

    if (stackFrames[0]) {
      printCodeFrame(stackFrames[0]);
    }

    printStack(stackFrames, rootPath);
  }
}

/**
 * Renders a frame's source into a code frame. The file read, `file://` unwrap,
 * and formatter call are shared by the CLI error printer and the md reporter.
 */
export const renderFrameCodeFrame = (
  frame: StackFrame,
  colors: Colors,
  window?: CodeFrameWindow,
): string | undefined => {
  const filePath = frame.file?.startsWith('file')
    ? new URL(frame.file)
    : frame.file;
  if (!filePath) return undefined;
  const source = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8')
    : undefined;
  if (!source) return undefined;
  return generateCodeFrame(
    source,
    frame.lineNumber,
    frame.column,
    colors,
    window,
  );
};

function printCodeFrame(frame: StackFrame) {
  const result = renderFrameCodeFrame(frame, color);
  if (!result) return;
  logger.stderr(result);
  logger.stderr('');
}

export function formatStack(frame: StackFrame, rootPath: string): string {
  return frame.methodName !== '<unknown>'
    ? `at ${frame.methodName} (${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column})`
    : `at ${formatTestPath(rootPath, frame.file!)}:${frame.lineNumber}:${frame.column}`;
}

function printStack(stackFrames: StackFrame[], rootPath: string) {
  for (const frame of stackFrames) {
    logger.stderr(color.gray(`        ${formatStack(frame, rootPath)}`));
  }
  if (stackFrames.length) logger.stderr('');
}

export const stackIgnores: RegExp[] = [
  /\/@rstest\/core/,
  /rstest\/packages\/core\/dist/,
  /node_modules\/chai/,
  /node_modules\/@vitest\/expect/,
  /node_modules\/@vitest\/snapshot/,
  /(^|\/)node:/,
  /(?:webpack|rspack)[\\/]runtime/,
  /(?:^|[\\/])(?:webpack|rspack)[\\/](?:bootstrap|startup)$/,
  // Source maps list the runtime module as a URL, so a frame mapped to it
  // points at `rstest%20runtime`.
  /rstest(?: |%20)runtime/,
  /<anonymous>/,
];

const normalizeFilePath = (file?: string | null): string | undefined => {
  if (!file) return undefined;
  if (!file.startsWith('file://')) return file;
  try {
    return fileURLToPath(file);
  } catch {
    return file;
  }
};

/**
 * A V8 stack starts with the error's name and message, and the stack parser
 * reads any line that ends like a location as a frame, such as
 * `Error: connect ECONNREFUSED 127.0.0.1:5432`. So when a stack has `at`
 * frames, only those lines are frames, plus the `file:line` that Node puts in
 * front of a CommonJS SyntaxError. Below it Node writes the source line, a `^`
 * marker and a blank line. The marker has no `^` at the end of the input, and
 * Node leaves it out when the error spans lines.
 * Firefox and WebKit stacks have no `at` lines and no message.
 */
const getFrameLines = (stack: string): string => {
  const frameLines = stack.split('\n').filter((line) => /^\s*at /.test(line));
  if (!frameLines.length) return stack;

  const [, location] =
    /^([^\n]*:\d+)\n[^\n]*\n(?:[\t ]*\^*\n)?\n/.exec(stack) || [];
  if (location) frameLines.unshift(location);
  return frameLines.join('\n');
};

/**
 * The stack parser reads a Windows drive path after a method name only with
 * backslashes, and test bundles have `pathe` paths with forward slashes. So on
 * Windows it reads a module frame such as
 * `at Object../src/a.ts (D:/project/dist/index.mjs:67:45)` as one file named
 * `Object../src/a.ts (D:/project/dist/index.mjs`, which has no source map.
 */
const splitMethodFromFile = (frame: StackFrame): StackFrame => {
  const [, methodName, file] =
    /^(.+?) \(([a-z]:\/.*)$/i.exec(frame.file ?? '') || [];
  return methodName && file ? { ...frame, methodName, file } : frame;
};

export async function parseErrorStacktrace({
  stack,
  getSourcemap,
  fullStack = isDebug(),
  ignore = stackIgnores,
}: {
  fullStack?: boolean;
  stack: string;
  getSourcemap?: GetSourcemap;
  ignore?: RegExp[];
}): Promise<StackFrame[]> {
  // Cache TraceMap per file to avoid redundant VLQ decoding when multiple
  // stack frames originate from the same source file.
  const traceMapCache = new Map<string, TraceMap>();

  const stackFrames = await Promise.all(
    stackTraceParse(getFrameLines(stack))
      .map(splitMethodFromFile)
      .filter((frame) => {
        if (fullStack) return true;
        const file = normalizeFilePath(frame.file);
        return Boolean(file && !ignore.some((entry) => file.match(entry)));
      })
      .map(async (frame) => {
        const file = normalizeFilePath(frame.file);
        if (!file) return frame;

        const sourcemap = await getSourcemap?.(file);
        if (sourcemap) {
          let traceMap = traceMapCache.get(file);
          if (!traceMap) {
            traceMap = new TraceMap(sourcemap);
            traceMapCache.set(file, traceMap);
          }
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
            file: isRelativePath(source)
              ? resolve(file, '../', source)
              : (() => {
                  // `source` can be a filesystem path (e.g. `C:\...`) or a URL-like
                  // string (e.g. `webpack://...`). `new URL()` throws for plain paths,
                  // so fall back to the raw value instead of crashing the reporter.
                  try {
                    return new URL(source).pathname;
                  } catch {
                    return source;
                  }
                })(),
            lineNumber: line,
            methodName: name || frame.methodName,
            column,
          };
        }
        return { ...frame, file };
      }),
  ).then((frames) =>
    frames.filter((frame): frame is StackFrame => frame !== null),
  );

  return fullStack
    ? stackFrames
    : stackFrames.filter((frame) => {
        if (!frame.file) {
          return false;
        }

        if (isHttpLikeFile(frame.file)) {
          return false;
        }

        const normalizedFile = frame.file.replace(/\\/g, '/');
        return !ignore.some((entry) => normalizedFile.match(entry));
      });
}
