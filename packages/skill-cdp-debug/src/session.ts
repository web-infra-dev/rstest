import type { ChildProcess } from 'node:child_process';
import { BreakpointInstaller } from './breakpointInstaller';
import { createCdpClient, evaluateExpressions } from './cdp';
import type { CliOptions, OutputWriter } from './plan';
import { ScriptPriorityQueue } from './scriptQueue';
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
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  MAX_DEBUG_SCRIPTS,
} from './types';

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
  reason?: string;
  callFrames?: Array<{
    callFrameId: string;
    location?: {
      scriptId: string;
      lineNumber: number;
      columnNumber?: number;
    };
  }>;
  hitBreakpoints?: string[];
};

type InstrumentationName =
  | 'beforeScriptExecution'
  | 'beforeScriptWithSourceMapExecution';

export class DebugSession {
  private readonly plan: Plan;
  private readonly options: CliOptions;
  private readonly cdp: CdpClient;
  private readonly runnerProcess: ChildProcess;
  private readonly output: OutputWriter;
  private readonly debugLog: (...args: unknown[]) => void;

  private readonly remaining: TaskDefinition[];
  private readonly initialTaskCount: number;
  private readonly armedTaskIds = new Set<string>();
  private readonly results: DebugResult['results'] = [];
  private readonly errors: ExecutionError[] = [];
  private readonly mappingDiagnostics: MappingDiagnostics[] = [];

  private readonly scripts = new Set<string>();
  private readonly scriptUrlById = new Map<string, string>();

  private readonly attemptedInstalls = new Set<string>();
  private readonly breakpoints = new Map<string, TaskDefinition>();
  private readonly armedTaskLocations = new Map<
    string,
    { scriptId: string; lineNumber: number; columnNumber: number }
  >();

  private readonly scriptQueue: ScriptPriorityQueue;
  private drainingQueue = false;

  private instrumentationBreakpointId: string | null = null;
  private pausedOnce = false;
  private scriptCount = 0;

  private finished = false;
  private breakpointTimeout: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly breakpointInstaller: BreakpointInstaller;

  constructor(ctx: DebugSessionContext) {
    this.plan = ctx.plan;
    this.options = ctx.options;
    this.cdp = ctx.cdp;
    this.runnerProcess = ctx.runnerProcess;
    this.output = ctx.output;
    this.debugLog = ctx.debugLog;

    this.remaining = [...ctx.tasks];
    this.initialTaskCount = ctx.tasks.length;

    this.scriptQueue = new ScriptPriorityQueue({
      cwd: this.plan.runner.cwd,
      tasks: ctx.tasks,
    });

    this.breakpointInstaller = new BreakpointInstaller({
      cdp: this.cdp,
      rootDir: this.plan.runner.cwd,
      options: this.options,
      debugLog: this.debugLog,
      attemptedInstalls: this.attemptedInstalls,
      breakpoints: this.breakpoints,
      armedTaskIds: this.armedTaskIds,
      mappingDiagnostics: this.mappingDiagnostics,
      errors: this.errors,
      onTaskMapped: (taskId, location) => {
        this.armedTaskLocations.set(taskId, location);
      },
    });
  }

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
      if (!this.armedTaskIds.size && this.remaining.length) {
        this.errors.push({ error: 'No breakpoints resolved for tasks.' });
        this.finalize(false);
        this.cdp.close();
      }
    }, DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS);
  }

  async enableAndRun(): Promise<void> {
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Debugger.enable');

    // Be explicit to avoid environment-specific defaults.
    await this.cdp.send('Debugger.setBreakpointsActive', { active: true });
    await this.cdp.send('Debugger.setSkipAllPauses', { skip: false });
    await this.cdp.send('Debugger.setBlackboxPatterns', { patterns: [] });

    // Fallback for cases where line breakpoints are mapped + set but never hit.
    // We pause on all exceptions and only consume the ones mapped to pending tasks.
    try {
      await this.cdp.send('Debugger.setPauseOnExceptions', {
        state: 'all',
      });
    } catch {
      // ignore
    }

    const { breakpointId } = await this.cdp.send<{ breakpointId: string }>(
      'Debugger.setInstrumentationBreakpoint',
      {
        instrumentation:
          'beforeScriptWithSourceMapExecution' satisfies InstrumentationName,
      },
    );
    this.instrumentationBreakpointId = breakpointId;

    await this.cdp.send('Runtime.runIfWaitingForDebugger');
  }

  onRunnerExit(code: number | null): void {
    if (!this.finished && this.remaining.length) {
      this.errors.push({
        error: `Runner exited before all tasks completed (code: ${code})`,
      });
      this.finalize(false);
    }
    this.cdp.close();
  }

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
    if (this.finished) return;
    if (!params?.scriptId || this.scripts.has(params.scriptId)) return;
    this.scripts.add(params.scriptId);
    this.scriptCount += 1;

    if (this.options.debug && this.scriptCount <= MAX_DEBUG_SCRIPTS) {
      this.debugLog('scriptParsed', params.scriptId, params.url || '');
    }

    if (params.url?.startsWith('node:')) return;

    if (params.url) {
      this.scriptUrlById.set(params.scriptId, params.url);
    }

    this.scriptQueue.enqueue({ scriptId: params.scriptId, url: params.url });
    void this.drainScriptQueue();
  }

  private async drainScriptQueue(): Promise<void> {
    if (this.drainingQueue || this.finished) return;
    this.drainingQueue = true;
    try {
      while (!this.finished && this.remaining.length) {
        const next = this.scriptQueue.takeNext();
        if (!next) break;
        const installedCount = await this.breakpointInstaller.installForScript({
          scriptId: next.scriptId,
          url: next.url,
          tasks: this.remaining,
        });
        this.clearBreakpointResolveTimeoutIfNeeded(installedCount);
      }
    } finally {
      this.drainingQueue = false;
    }
  }

  private clearBreakpointResolveTimeoutIfNeeded(installedCount: number): void {
    if (!installedCount) return;
    if (this.breakpointTimeout) {
      clearTimeout(this.breakpointTimeout);
      this.breakpointTimeout = null;
    }
  }

  private async barrier(): Promise<void> {
    // A synchronous CDP round-trip to help ensure breakpoints become active
    // before resuming execution.
    try {
      await this.cdp.send('Runtime.evaluate', {
        expression: '0',
        returnByValue: true,
      });
    } catch {
      // ignore
    }
  }

  private isInstrumentationPause(params: DebuggerPausedParams): boolean {
    if (params.reason === 'instrumentation') return true;
    if (!this.instrumentationBreakpointId) return false;
    return Boolean(
      params.hitBreakpoints?.includes(this.instrumentationBreakpointId),
    );
  }

  private async onPaused(params: DebuggerPausedParams): Promise<void> {
    if (this.finished) return;
    // First pause comes from `--inspect-brk`.
    if (!this.pausedOnce) {
      this.pausedOnce = true;
      await this.cdp.send('Debugger.resume');
      return;
    }

    this.resetInactivityTimer();

    if (this.options.debug) {
      const loc = params.callFrames?.[0]?.location;
      const locText = loc
        ? `${loc.scriptId}:${loc.lineNumber}:${loc.columnNumber ?? 0}`
        : '';
      const hits = params.hitBreakpoints?.length
        ? params.hitBreakpoints.join(',')
        : '';
      this.debugLog('paused', params.reason || '', hits, locText);
    }

    if (this.isInstrumentationPause(params)) {
      await this.handleInstrumentationPause(params);
      return;
    }

    if (params.reason === 'exception' || params.reason === 'promiseRejection') {
      const handled = await this.handleExceptionPause(params);
      if (handled) return;
    }

    await this.handleBreakpointPause(params);
  }

  private async handleExceptionPause(
    params: DebuggerPausedParams,
  ): Promise<boolean> {
    if (this.finished || !this.remaining.length) {
      await this.cdp.send('Debugger.resume');
      return true;
    }

    const callFrames = params.callFrames ?? [];
    if (!callFrames.length) return false;

    const MAX_FRAME_DISTANCE_LINES = 500;

    const pending = this.remaining
      .map((task) => ({ task, loc: this.armedTaskLocations.get(task.id) }))
      .filter(
        (
          item,
        ): item is {
          task: TaskDefinition;
          loc: { scriptId: string; lineNumber: number; columnNumber: number };
        } => Boolean(item.loc),
      );
    if (!pending.length) return false;

    const matches: Array<{
      task: TaskDefinition;
      frame: NonNullable<DebuggerPausedParams['callFrames']>[number];
    }> = [];
    for (const { task, loc } of pending) {
      let best:
        | {
            frame: NonNullable<DebuggerPausedParams['callFrames']>[number];
            dist: number;
          }
        | undefined;
      for (const frame of callFrames) {
        const frameLoc = frame.location;
        if (!frameLoc) continue;
        if (frameLoc.scriptId !== loc.scriptId) continue;
        const dist = Math.abs(frameLoc.lineNumber - loc.lineNumber);
        if (!best || dist < best.dist) best = { frame, dist };
      }
      if (best && best.dist <= MAX_FRAME_DISTANCE_LINES) {
        matches.push({ task, frame: best.frame });
      }
    }

    if (!matches.length) {
      if (this.options.debug) {
        const taskScripts = Array.from(
          new Set(pending.map(({ loc }) => loc.scriptId)),
        ).join(',');
        const topFrames = callFrames
          .slice(0, 8)
          .map((f) => {
            const l = f.location;
            if (!l) return '?:?:?';
            return `${l.scriptId}:${l.lineNumber}:${l.columnNumber ?? 0}`;
          })
          .join(',');
        const hasAnyTaskScript = callFrames.some((f) => {
          const l = f.location;
          if (!l) return false;
          return pending.some(({ loc }) => loc.scriptId === l.scriptId);
        });
        this.debugLog(
          'ignored error pause',
          params.reason || '',
          `taskScripts=${taskScripts}`,
          `hasTaskScript=${hasAnyTaskScript}`,
          topFrames,
        );
      }
      return false;
    }

    if (this.options.debug) {
      const topFrames = callFrames
        .slice(0, 8)
        .map((f) => {
          const l = f.location;
          if (!l) return '?:?:?';
          return `${l.scriptId}:${l.lineNumber}:${l.columnNumber ?? 0}`;
        })
        .join(',');
      this.debugLog('handled error pause', params.reason || '', topFrames);
    }

    for (const { task, frame } of matches) {
      const ok = await this.captureTaskOnFrame(task, frame.callFrameId);
      if (!ok) continue;
    }

    await this.cdp.send('Debugger.resume');
    if (!this.remaining.length) {
      this.finalize(true);
      this.cdp.close();
    }
    return true;
  }

  private async captureTaskOnFrame(
    task: TaskDefinition,
    callFrameId: string,
  ): Promise<boolean> {
    if (task.condition) {
      const condResult = await this.cdp.send<{ result?: { value?: unknown } }>(
        'Debugger.evaluateOnCallFrame',
        {
          callFrameId,
          expression: task.condition,
          returnByValue: true,
        },
      );
      if (!condResult?.result?.value) return false;
    }

    const expressions = task.expressions?.length
      ? task.expressions
      : this.options.expression
        ? [this.options.expression]
        : [];

    if (!expressions.length) {
      this.errors.push({ taskId: task.id, error: 'No expressions specified.' });
      return false;
    }

    const evaluated = await evaluateExpressions({
      cdp: this.cdp,
      callFrameId,
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

    task.hits = (task.hits ?? 0) + 1;
    if (task.hits >= (task.hitLimit ?? 1)) {
      const idx = this.remaining.findIndex((t) => t.id === task.id);
      if (idx >= 0) this.remaining.splice(idx, 1);
      this.breakpoints.forEach((value, key) => {
        if (value.id === task.id) this.breakpoints.delete(key);
      });
    }

    return true;
  }

  private async handleInstrumentationPause(
    params: DebuggerPausedParams,
  ): Promise<void> {
    const scriptId = params.callFrames?.[0]?.location?.scriptId;
    if (scriptId) {
      const installedCount = await this.breakpointInstaller.installForScript({
        scriptId,
        url: this.scriptUrlById.get(scriptId),
        tasks: this.remaining,
      });
      this.clearBreakpointResolveTimeoutIfNeeded(installedCount);

      // Ensure installed breakpoints are active before resuming.
      if (installedCount) await this.barrier();

      if (
        this.instrumentationBreakpointId &&
        this.armedTaskIds.size >= this.initialTaskCount
      ) {
        await this.cdp.send('Debugger.removeBreakpoint', {
          breakpointId: this.instrumentationBreakpointId,
        });
        this.instrumentationBreakpointId = null;
      }
    }

    await this.cdp.send('Debugger.resume');
  }

  private async handleBreakpointPause(
    params: DebuggerPausedParams,
  ): Promise<void> {
    const frame = params.callFrames?.[0];
    const breakpointId = params.hitBreakpoints?.[0];

    if (!frame || !breakpointId) {
      await this.cdp.send('Debugger.resume');
      return;
    }

    const task = this.breakpoints.get(breakpointId);
    if (!task) {
      await this.cdp.send('Debugger.resume');
      return;
    }

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

    task.hits = (task.hits ?? 0) + 1;
    if (task.hits >= (task.hitLimit ?? 1)) {
      const idx = this.remaining.findIndex((t) => t.id === task.id);
      if (idx >= 0) this.remaining.splice(idx, 1);
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
