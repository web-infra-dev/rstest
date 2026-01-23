import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
  originalPositionFor,
  type SourceMapInput,
  TraceMap,
} from '@jridgewell/trace-mapping';
import { parse } from 'stacktrace-parser';
import type { GetSourcemap } from './types';

export type StackFrame = {
  file?: string;
  methodName?: string;
  lineNumber?: number;
  column?: number;
};

const stackIgnores: (RegExp | string)[] = [
  /\/node_modules\//,
  /\/rstest\/packages\/core\/dist/,
  /\/@rstest\/core/,
  /\/tinypool/,
  /\/chai/,
  /\/node:\w+/,
  /webpack\/runtime/,
  /webpack\\runtime/,
  '<anonymous>',
];

const isRelativePath = (value: string): boolean => /^\.\.\/?/.test(value);

const normalizeFilePath = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  if (value.startsWith('file://')) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }
  return value;
};

const trimLeadingNodeFrames = (frames: StackFrame[]): StackFrame[] => {
  let startIndex = 0;
  while (startIndex < frames.length) {
    const file = frames[startIndex]?.file;
    if (file?.startsWith('node:')) {
      startIndex += 1;
      continue;
    }
    break;
  }
  return frames.slice(startIndex);
};

const dropNodeFrames = (frames: StackFrame[]): StackFrame[] =>
  frames.filter((frame) => !frame.file?.startsWith('node:'));

const resolveModuleRoot = (spec: string): string | null => {
  try {
    if (typeof import.meta.resolve === 'function') {
      const resolved = import.meta.resolve(`${spec}/package.json`);
      const filePath = resolved.startsWith('file://')
        ? new URL(resolved).pathname
        : resolved;
      return dirname(filePath);
    }
  } catch {
    // fallback below
  }

  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve(`${spec}/package.json`));
  } catch {
    return null;
  }
};

const resolveExcludedRoots = (): string[] => {
  const resolvedRoots: string[] = [];
  const candidates = ['@rstest/core', '@rstest/reporter-agent-md'];
  for (const spec of candidates) {
    const root = resolveModuleRoot(spec);
    if (root) {
      resolvedRoots.push(root);
    }
  }
  return resolvedRoots;
};

const excludedRoots = resolveExcludedRoots();

export const parseErrorStacktrace = async ({
  stack,
  getSourcemap,
  fullStack = false,
}: {
  stack: string;
  getSourcemap?: GetSourcemap;
  fullStack?: boolean;
}): Promise<StackFrame[]> => {
  const frames = parse(stack)
    .filter((frame) => {
      if (fullStack) return true;
      if (!frame.file) return false;
      const filePath = normalizeFilePath(frame.file) || '';
      if (excludedRoots.some((root) => filePath.startsWith(root))) {
        return false;
      }
      return !stackIgnores.some((entry) => filePath.match(entry));
    })
    .map(async (frame) => {
      const file = normalizeFilePath(frame.file);
      if (!file || !getSourcemap) {
        return {
          ...frame,
          file,
        };
      }

      const sourcemap = (await getSourcemap(
        file,
      )) as unknown as SourceMapInput | null;
      if (!sourcemap) {
        return {
          ...frame,
          file,
        };
      }

      const traceMap = new TraceMap(sourcemap);
      const { line, column, source, name } = originalPositionFor(traceMap, {
        line: frame.lineNumber || 1,
        column: frame.column || 1,
      });

      if (!source) {
        return null;
      }

      const mappedFile = isRelativePath(source)
        ? resolve(file || '', '../', source)
        : (() => {
            try {
              return new URL(source).pathname;
            } catch {
              return source;
            }
          })();

      return {
        ...frame,
        file: mappedFile,
        lineNumber: line || frame.lineNumber,
        column: column || frame.column,
        methodName: name || frame.methodName,
      };
    });

  const resolvedFrames = await Promise.all(frames);
  const filteredFrames = resolvedFrames.filter(
    (frame) => frame !== null,
  ) as StackFrame[];
  return dropNodeFrames(trimLeadingNodeFrames(filteredFrames));
};
