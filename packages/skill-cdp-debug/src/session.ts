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
  private readonly results: DebugResult['results'] = [];
  private readonly errors: ExecutionError[] = [];
  private readonly mappingDiagnostics: MappingDiagnostics[] = [];

  private readonly scripts = new Set<string>();
  private readonly attemptedInstalls = new Set<string>();
  private readonly breakpoints = new Map<string, TaskDefinition>();

  private readonly scriptUrlById = new Map<string, string>();

  private readonly scriptQueue: ScriptPriorityQueue;
  private readonly breakpointInstaller: BreakpointInstaller;
  private drainingQueue = false;

  private instrumentationBreakpointId: string | null = null;
  private readonly armedTaskIds = new Set<string>();

  private finished = false;
  private breakpointTimeout: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  private pausedOnce = false;

  private scriptCount = 0;

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
    });
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

  private clearBreakpointResolveTimeoutIfNeeded(installedCount: number): void {
    if (installedCount <= 0) return;
    if (!this.breakpointTimeout) return;
    clearTimeout(this.breakpointTimeout);
    this.breakpointTimeout = null;
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

    if (params.url) {
      this.scriptUrlById.set(params.scriptId, params.url);
    }

    // Queue scripts for prioritized breakpoint resolution. Correctness is
    // guaranteed by the instrumentation breakpoint; this queue reduces the
    // number of instrumentation pauses by arming tasks early.
    this.scriptQueue.enqueue({ scriptId: params.scriptId, url: params.url });
    void this.drainScriptQueue();
  }

  private async drainScriptQueue(): Promise<void> {
    if (this.drainingQueue || this.finished) return;
    this.drainingQueue = true;
    try {
      while (
        !this.finished &&
        this.remaining.length &&
        this.armedTaskIds.size < this.initialTaskCount
      ) {
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

  private async onPaused(params: DebuggerPausedParams): Promise<void> {
    if (!this.pausedOnce) {
      await this.handleInitialPause();
      return;
    }

    this.resetInactivityTimer();

    if (this.isInstrumentationPause(params)) {
      await this.handleInstrumentationPause(params);
      return;
    }

    await this.handleBreakpointPause(params);
  }

  private isInstrumentationPause(params: DebuggerPausedParams): boolean {
    if (params.reason === 'instrumentation') return true;
    if (!this.instrumentationBreakpointId) return false;
    return Boolean(
      params.hitBreakpoints?.includes(this.instrumentationBreakpointId),
    );
  }

  private async handleInitialPause(): Promise<void> {
    // First pause comes from `--inspect-brk`.
    this.pausedOnce = true;
    await this.cdp.send('Debugger.resume');
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
