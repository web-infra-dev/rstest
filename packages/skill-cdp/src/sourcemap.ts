import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GREATEST_LOWER_BOUND,
  generatedPositionFor,
  LEAST_UPPER_BOUND,
  TraceMap,
} from '@jridgewell/trace-mapping';
import type { CdpClient, MappingDiagnostics, TaskDefinition } from './types';

// ============================================================================
// Source Map Resolution
// ============================================================================

const INLINE_SOURCEMAP_REGEX =
  /\/\/[#@]\s*sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([^\s]+)/;
const FILE_SOURCEMAP_REGEX = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/;

const normalizePath = (value: string) => value.replace(/\\/g, '/');

/**
 * Normalize source paths from sourcemaps.
 * Handles webpack/rspack prefixes like:
 * - webpack:///./src/foo.ts
 * - webpack://<project>/./src/foo.ts
 */
const normalizeMapSourcePath = (value: string) => {
  if (!value) return '';
  if (value.startsWith('file://')) {
    try {
      return normalizePath(fileURLToPath(value));
    } catch {
      // fall through
    }
  }
  let source = normalizePath(value);
  source = source.replace(/^[a-zA-Z]+:\/\/\/+/, '');
  const firstSlash = source.indexOf('/');
  if (firstSlash >= 0) source = source.slice(firstSlash + 1);
  source = source.replace(/^\.(\/|\\)/, '');
  return source;
};

const matchesSource = (source: string, target: string, rootDir?: string) => {
  const sourceValue = normalizeMapSourcePath(source);
  const targetValue = normalizePath(target);
  const targetRelative = rootDir
    ? normalizePath(path.relative(rootDir, targetValue))
    : '';
  const candidates = [targetValue, targetRelative].filter(Boolean);
  const targetBase = path.posix.basename(targetValue);

  return (
    candidates.some(
      (c) =>
        sourceValue === c || sourceValue.endsWith(c) || c.endsWith(sourceValue),
    ) ||
    (targetBase && sourceValue.endsWith(`/${targetBase}`)) ||
    sourceValue === targetBase
  );
};

/** Try line and adjacent lines to handle minification offset */
const hintTaskLines = (task: TaskDefinition) =>
  [task.line, task.line - 1, task.line + 1].filter((v) => v > 0);

const parseSourceMap = (source: string, scriptUrl?: string) => {
  // Inline base64 sourcemap
  const inlineMatch = source.match(INLINE_SOURCEMAP_REGEX);
  if (inlineMatch?.[1]) {
    const json = Buffer.from(inlineMatch[1], 'base64').toString('utf-8');
    return JSON.parse(json);
  }
  // External sourcemap file
  const fileMatch = source.match(FILE_SOURCEMAP_REGEX);
  if (!fileMatch?.[1] || !scriptUrl?.startsWith('file://')) return null;
  const scriptPath = fileURLToPath(scriptUrl);
  const mapPath = path.resolve(path.dirname(scriptPath), fileMatch[1]);
  return JSON.parse(readFileSync(mapPath, 'utf-8'));
};

export type BreakpointResolution = {
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  } | null;
  diagnostics: MappingDiagnostics;
};

export const resolveBreakpoint = async ({
  cdp,
  scriptId,
  url,
  task,
  rootDir,
}: {
  cdp: CdpClient;
  scriptId: string;
  url?: string;
  task: TaskDefinition;
  rootDir?: string;
}): Promise<BreakpointResolution> => {
  try {
    const { scriptSource } = await cdp.send<{ scriptSource: string }>(
      'Debugger.getScriptSource',
      { scriptId },
    );
    const sourceMap = parseSourceMap(scriptSource, url);
    if (!sourceMap) {
      return {
        location: null,
        diagnostics: {
          scriptId,
          url,
          taskId: task.id,
          reason: 'no-sourcemap',
          hasSourceMapComment: FILE_SOURCEMAP_REGEX.test(scriptSource),
        },
      };
    }

    const traceMap = new TraceMap(sourceMap);
    const matchedSource = traceMap.sources.find(
      (s) => s && matchesSource(s, task.sourcePath, rootDir),
    );
    if (!matchedSource) {
      return {
        location: null,
        diagnostics: {
          scriptId,
          url,
          taskId: task.id,
          reason: 'source-mismatch',
          sourcesSample: traceMap.sources
            .filter((s): s is string => Boolean(s))
            .slice(0, 3),
        },
      };
    }

    // Try multiple column/line combinations to find a valid mapping
    const columns = [task.column ?? 0, 0, Math.max((task.column ?? 0) - 1, 0)];
    let generated: { line: number; column: number } | null = null;

    outer: for (const col of columns) {
      for (const line of hintTaskLines(task)) {
        const primary = generatedPositionFor(traceMap, {
          source: matchedSource,
          line,
          column: col,
          bias: GREATEST_LOWER_BOUND,
        });
        const fallback = generatedPositionFor(traceMap, {
          source: matchedSource,
          line,
          column: col,
          bias: LEAST_UPPER_BOUND,
        });
        const resolved = primary?.line ? primary : fallback;
        if (resolved?.line) {
          generated = { line: resolved.line, column: resolved.column };
          break outer;
        }
      }
    }

    if (!generated?.line || generated.column == null) {
      return {
        location: null,
        diagnostics: {
          scriptId,
          url,
          taskId: task.id,
          reason: 'generated-position-missing',
          matchedSource,
        },
      };
    }

    return {
      location: {
        scriptId,
        lineNumber: generated.line - 1, // CDP uses 0-based line numbers
        columnNumber: generated.column,
      },
      diagnostics: {
        scriptId,
        url,
        taskId: task.id,
        reason: 'ok',
        matchedSource,
        generatedLine: generated.line,
        generatedColumn: generated.column,
      },
    };
  } catch (error) {
    return {
      location: null,
      diagnostics: {
        scriptId,
        url,
        taskId: task.id,
        reason: 'script-error',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
