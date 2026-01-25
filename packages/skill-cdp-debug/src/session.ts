import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GREATEST_LOWER_BOUND,
  generatedPositionFor,
  LEAST_UPPER_BOUND,
  TraceMap,
} from '@jridgewell/trace-mapping';
import { createCdpClient, evaluateExpressions } from './cdp';
import type { CliOptions, OutputWriter } from './plan';
import type {
  CdpClient,
  DebugResult,
  ExecutionError,
  MappingDiagnostics,
  Plan,
  TaskDefinition,
} from './types';
import {
  DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS,
  DEFAULT_FIRST_PAUSE_GRACE_MS,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  MAX_DEBUG_MAPPING,
  MAX_DEBUG_SCRIPTS,
  MAX_MAPPING_DIAGNOSTICS,
} from './types';

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

type BreakpointResolution = {
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  } | null;
  diagnostics: MappingDiagnostics;
};

const resolveBreakpoint = async ({
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

// ============================================================================
// Debug Session
// ============================================================================

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const readWorkspacePath = (filePath: string, rootPath: string) =>
  filePath.replace(rootPath, '').replace(/^\//, '').replace(/\\/g, '/');

export type DebugSessionContext = {
  plan: Plan;
  options: CliOptions;
  tasks: TaskDefinition[];
  cdp: CdpClient;
  runnerProcess: ChildProcess;
  output: OutputWriter;
  debugLog: (...args: unknown[]) => void;
};

type DebuggerScriptParsedParams = { scriptId: string; url?: string };
type DebuggerPausedParams = {
  callFrames?: Array<{ callFrameId: string }>;
  hitBreakpoints?: string[];
};

export class DebugSession {
  private readonly plan: Plan;
  private readonly options: CliOptions;
  private readonly cdp: CdpClient;
  private readonly runnerProcess: ChildProcess;
  private readonly output: OutputWriter;
  private readonly debugLog: (...args: unknown[]) => void;

  private readonly remaining: TaskDefinition[];
  private readonly results: DebugResult['results'] = [];
  private readonly errors: ExecutionError[] = [];
  private readonly mappingDiagnostics: MappingDiagnostics[] = [];

  private readonly scripts = new Set<string>();
  private readonly triedScripts = new Set<string>();
  private readonly breakpoints = new Map<string, TaskDefinition>();

  private finished = false;
  private breakpointTimeout: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  private pausedOnce = false;
  private breakpointReadyResolve: (() => void) | null = null;
  private readonly breakpointReady = new Promise<void>((resolve) => {
    this.breakpointReadyResolve = resolve;
  });

  private scriptCount = 0;

  constructor(ctx: DebugSessionContext) {
    this.plan = ctx.plan;
    this.options = ctx.options;
    this.cdp = ctx.cdp;
    this.runnerProcess = ctx.runnerProcess;
    this.output = ctx.output;
    this.debugLog = ctx.debugLog;
    this.remaining = [...ctx.tasks];
  }

  /** Start listening for CDP events and set up timeout */
  start(): void {
    this.cdp.on<DebuggerScriptParsedParams>(
      'Debugger.scriptParsed',
      (params) => void this.onScriptParsed(params),
    );
    this.cdp.on<DebuggerPausedParams>(
      'Debugger.paused',
      (params) => void this.onPaused(params),
    );

    this.breakpointTimeout = setTimeout(() => {
      if (!this.breakpoints.size && this.remaining.length) {
        this.errors.push({ error: 'No breakpoints resolved for tasks.' });
        this.finalize(false);
        this.cdp.close();
      }
    }, DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS);
  }

  /** Enable debugger and start execution */
  async enableAndRun(): Promise<void> {
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Debugger.enable');
    await this.cdp.send('Runtime.runIfWaitingForDebugger');
  }

  /** Handle runner process exit */
  onRunnerExit(code: number | null): void {
    if (!this.finished && this.remaining.length) {
      this.errors.push({
        error: `Runner exited before all tasks completed (code: ${code})`,
      });
      this.finalize(false);
    }
    this.cdp.close();
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private finalize(ok: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();

    const output: DebugResult = {
      ok,
      results: this.results,
      errors: this.errors,
      meta: {
        runner: this.plan.runner,
        forwardedArgs: [this.plan.runner.cmd, ...this.plan.runner.args],
        taskFilter: this.options.taskFilter,
        pendingTaskIds: this.remaining.map((t) => t.id),
        mappingDiagnostics: this.mappingDiagnostics,
      },
    };
    this.output.write(output);

    if (!ok && this.runnerProcess.exitCode == null) {
      this.runnerProcess.kill('SIGTERM');
    }
  }

  private clearTimers(): void {
    if (this.breakpointTimeout) {
      clearTimeout(this.breakpointTimeout);
      this.breakpointTimeout = null;
    }
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.errors.push({ error: 'Timeout waiting for breakpoint hits.' });
      this.finalize(false);
      this.cdp.close();
    }, DEFAULT_INACTIVITY_TIMEOUT_MS);
  }

  private async onScriptParsed(
    params: DebuggerScriptParsedParams,
  ): Promise<void> {
    if (!params?.scriptId || this.scripts.has(params.scriptId)) return;
    this.scripts.add(params.scriptId);
    this.scriptCount += 1;

    if (this.options.debug && this.scriptCount <= MAX_DEBUG_SCRIPTS) {
      this.debugLog('scriptParsed', params.scriptId, params.url || '');
    }

    // Skip internal Node.js scripts
    if (params.url?.startsWith('node:')) return;

    const tasksToResolve = this.remaining.filter(
      (task) => !this.triedScripts.has(`${params.scriptId}:${task.id}`),
    );

    await Promise.all(
      tasksToResolve.map(async (task) => {
        this.triedScripts.add(`${params.scriptId}:${task.id}`);
        const resolution = await resolveBreakpoint({
          cdp: this.cdp,
          scriptId: params.scriptId,
          url: params.url,
          task,
          rootDir: this.plan.runner.cwd,
        });

        if (this.mappingDiagnostics.length < MAX_MAPPING_DIAGNOSTICS) {
          this.mappingDiagnostics.push(resolution.diagnostics);
        }

        if (!resolution.location) {
          if (
            this.options.debug &&
            this.mappingDiagnostics.length <= MAX_DEBUG_MAPPING
          ) {
            this.debugLog('mapping', resolution.diagnostics);
          }
          return;
        }

        try {
          const result = await this.cdp.send<{ breakpointId: string }>(
            'Debugger.setBreakpoint',
            { location: resolution.location },
          );
          this.breakpoints.set(result.breakpointId, task);
          this.debugLog(
            `breakpoint set for ${task.id} at ${resolution.location.scriptId}`,
            `${resolution.location.lineNumber}:${resolution.location.columnNumber}`,
          );
          if (this.breakpointTimeout) {
            clearTimeout(this.breakpointTimeout);
            this.breakpointTimeout = null;
          }
        } catch (error) {
          this.errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (this.breakpoints.size) {
      this.breakpointReadyResolve?.();
    }
  }

  private async onPaused(params: DebuggerPausedParams): Promise<void> {
    // First pause: wait for breakpoints to be ready, then resume
    if (!this.pausedOnce) {
      this.pausedOnce = true;
      await Promise.race([
        this.breakpointReady,
        wait(DEFAULT_FIRST_PAUSE_GRACE_MS),
      ]);
      await this.cdp.send('Debugger.resume');
      if (this.breakpoints.size) this.resetInactivityTimer();
      return;
    }

    this.resetInactivityTimer();

    const frame = params.callFrames?.[0];
    const hitBreakpointId = params.hitBreakpoints?.[0];
    if (!frame || !hitBreakpointId) {
      await this.cdp.send('Debugger.resume');
      return;
    }

    const task = this.breakpoints.get(hitBreakpointId);
    if (!task) {
      await this.cdp.send('Debugger.resume');
      return;
    }

    // Check condition if specified
    if (task.condition) {
      const condResult = await this.cdp.send<{ result?: { value?: unknown } }>(
        'Debugger.evaluateOnCallFrame',
        {
          callFrameId: frame.callFrameId,
          expression: task.condition,
          returnByValue: true,
        },
      );
      if (!condResult?.result?.value) {
        await this.cdp.send('Debugger.resume');
        return;
      }
    }

    // Determine expressions to evaluate
    const expressions = task.expressions?.length
      ? task.expressions
      : this.options.expression
        ? [this.options.expression]
        : [];
    if (!expressions.length) {
      this.errors.push({ taskId: task.id, error: 'No expressions specified.' });
      await this.cdp.send('Debugger.resume');
      return;
    }

    // Evaluate and record result
    const evaluated = await evaluateExpressions({
      cdp: this.cdp,
      callFrameId: frame.callFrameId,
      expressions,
    });

    this.results.push({
      id: task.id,
      description: task.description,
      sourcePath: readWorkspacePath(task.sourcePath, this.plan.runner.cwd),
      line: task.line,
      column: task.column ?? 0,
      values: evaluated,
    });

    // Track hits and remove completed tasks
    task.hits = (task.hits ?? 0) + 1;
    if (task.hits >= (task.hitLimit ?? 1)) {
      const index = this.remaining.findIndex((t) => t.id === task.id);
      if (index >= 0) this.remaining.splice(index, 1);
      this.breakpoints.forEach((value, key) => {
        if (value.id === task.id) this.breakpoints.delete(key);
      });
    }

    await this.cdp.send('Debugger.resume');
    if (!this.remaining.length) {
      this.finalize(true);
      this.cdp.close();
    }
  }
}

// Re-export for index.ts
export { createCdpClient };
