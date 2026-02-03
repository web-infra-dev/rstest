import type { ChildProcess } from 'node:child_process';
import { createCdpClient, evaluateExpressions } from './cdp';
import type { CliOptions, OutputWriter } from './plan';
import { resolveBreakpoint } from './sourcemap';
import type {
  CdpClient,
  DebugResult,
  DebugStatus,
  ExecutionError,
  MappingDiagnostics,
  Plan,
  TaskDefinition,
} from './types';
import {
  DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  MAX_DEBUG_MAPPING,
  MAX_DEBUG_SCRIPTS,
  MAX_MAPPING_DIAGNOSTICS,
} from './types';

// ============================================================================
// Debug Session
// ============================================================================

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
  reason?: string;
  data?: { scriptId?: string; url?: string };
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

  private scriptCount = 0;

  /**
   * Map of scriptId -> Promise that resolves when the script has been processed
   * for breakpoint resolution. This is used to coordinate between scriptParsed
   * and instrumentation pause events, which can fire in either order.
   */
  private readonly scriptProcessed = new Map<string, Promise<void>>();
  private readonly scriptProcessedResolvers = new Map<string, () => void>();

  /**
   * Get or create a Promise for tracking when a script has been processed.
   * This method is safe to call from either onScriptParsed or onPaused,
   * regardless of which fires first.
   */
  private getOrCreateScriptPromise(scriptId: string): Promise<void> {
    const existing = this.scriptProcessed.get(scriptId);
    if (existing) {
      return existing;
    }
    let resolver: () => void;
    const promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    this.scriptProcessed.set(scriptId, promise);
    this.scriptProcessedResolvers.set(scriptId, resolver!);
    return promise;
  }

  /**
   * Mark a script as processed (resolve its Promise).
   * If the Promise doesn't exist yet, create it first then resolve.
   */
  private markScriptProcessed(scriptId: string): void {
    // Ensure the Promise exists (in case onPaused hasn't created it yet)
    if (!this.scriptProcessed.has(scriptId)) {
      this.getOrCreateScriptPromise(scriptId);
    }
    const resolver = this.scriptProcessedResolvers.get(scriptId);
    if (resolver) {
      resolver();
    }
  }

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

    const breakpointTimeoutMs =
      this.options.breakpointTimeout ?? DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS;
    this.breakpointTimeout = setTimeout(() => {
      if (!this.breakpoints.size && this.remaining.length) {
        this.errors.push({ error: 'No breakpoints resolved for tasks.' });
        this.finalize(this.runnerProcess.exitCode);
        this.cdp.close();
      }
    }, breakpointTimeoutMs);
  }

  /** Enable debugger and start execution */
  async enableAndRun(): Promise<void> {
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Debugger.enable');
    // Set instrumentation breakpoint to pause before each script execution
    // This ensures we can set breakpoints before the script runs
    try {
      await this.cdp.send('Debugger.setInstrumentationBreakpoint', {
        instrumentation: 'beforeScriptExecution',
      });
      this.debugLog('instrumentation breakpoint set: beforeScriptExecution');
    } catch (error) {
      this.debugLog(
        'failed to set instrumentation breakpoint:',
        error instanceof Error ? error.message : String(error),
      );
    }
    await this.cdp.send('Runtime.runIfWaitingForDebugger');
  }

  /** Handle runner process exit */
  onRunnerExit(code: number | null): void {
    if (!this.finished) {
      this.finalize(code);
    }
    this.cdp.close();
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private finalize(exitCode: number | null): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();

    // Determine status based on results and remaining tasks
    let status: DebugStatus;
    if (this.results.length === 0) {
      status = 'failed';
    } else if (this.remaining.length === 0) {
      status = 'full_succeed';
    } else {
      status = 'partial_succeed';
    }

    const output: DebugResult = {
      status,
      exitCode,
      results: this.results,
      errors: this.errors,
      // Only include meta in debug mode - it's diagnostic info not needed for normal use
      ...(this.options.debug && {
        meta: {
          runner: this.plan.runner,
          forwardedArgs: [this.plan.runner.cmd, ...this.plan.runner.args],
          pendingTaskIds: this.remaining.map((t) => t.id),
          mappingDiagnostics: this.mappingDiagnostics,
        },
      }),
    };
    this.output.write(output);

    if (status === 'failed' && this.runnerProcess.exitCode == null) {
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
    const inactivityTimeoutMs =
      this.options.inactivityTimeout ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.inactivityTimer = setTimeout(() => {
      this.errors.push({ error: 'Timeout waiting for breakpoint hits.' });
      this.finalize(this.runnerProcess.exitCode);
      this.cdp.close();
    }, inactivityTimeoutMs);
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
    if (params.url?.startsWith('node:')) {
      this.markScriptProcessed(params.scriptId);
      return;
    }

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
            {
              location: resolution.location,
              ...(task.condition ? { condition: task.condition } : {}),
            },
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

    // Mark this script as processed so instrumentation pause can resume
    this.markScriptProcessed(params.scriptId);
  }

  private async onPaused(params: DebuggerPausedParams): Promise<void> {
    // Skip if session already finished (WebSocket may be closing/closed)
    if (this.finished) {
      this.debugLog('onPaused skipped (session finished)');
      return;
    }

    this.debugLog('onPaused', {
      reason: params.reason,
      pausedOnce: this.pausedOnce,
      hitBreakpoints: params.hitBreakpoints,
      breakpointCount: this.breakpoints.size,
      breakpointIds: Array.from(this.breakpoints.keys()),
      data: params.data,
    });

    // Handle instrumentation breakpoints (beforeScriptExecution)
    // These fire before each script runs, giving us a chance to set breakpoints
    if (params.reason === 'instrumentation') {
      const scriptId = params.data?.scriptId;
      if (scriptId) {
        // Wait for the scriptParsed handler to finish processing this script
        // This ensures breakpoints are set before the script executes
        // Note: getOrCreateScriptPromise handles the race condition where
        // onPaused may fire before onScriptParsed
        const processedPromise = this.getOrCreateScriptPromise(scriptId);
        await processedPromise;
        // Check again after await - session may have finished while waiting
        if (this.finished) {
          this.debugLog('onPaused skipped after wait (session finished)');
          return;
        }
        this.debugLog('script processed, resuming', scriptId);
      }
      // After all breakpoints are set, disable instrumentation to avoid performance hit
      if (this.breakpoints.size >= this.remaining.length) {
        try {
          await this.cdp.send('Debugger.removeInstrumentationBreakpoint', {
            instrumentation: 'beforeScriptExecution',
          });
          this.debugLog('instrumentation breakpoint removed');
        } catch (error) {
          this.debugLog(
            'failed to remove instrumentation breakpoint:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      try {
        await this.cdp.send('Debugger.resume');
      } catch (error) {
        this.debugLog(
          'failed to resume after instrumentation:',
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }

    // First pause (from --inspect-brk): just resume, instrumentation breakpoint will handle the rest
    if (!this.pausedOnce) {
      this.pausedOnce = true;
      this.debugLog('first pause resume (instrumentation enabled)');
      await this.cdp.send('Debugger.resume');
      if (this.breakpoints.size) this.resetInactivityTimer();
      return;
    }

    this.resetInactivityTimer();

    const frame = params.callFrames?.[0];
    const hitBreakpointId = params.hitBreakpoints?.[0];
    this.debugLog('breakpoint hit check', { frame: !!frame, hitBreakpointId });
    if (!frame || !hitBreakpointId) {
      await this.cdp.send('Debugger.resume');
      return;
    }

    const task = this.breakpoints.get(hitBreakpointId);
    if (!task) {
      await this.cdp.send('Debugger.resume');
      return;
    }

    // Determine expressions to evaluate
    const expressions = task.expressions?.length ? task.expressions : [];
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
      this.finalize(this.runnerProcess.exitCode);
      this.cdp.close();
    }
  }
}

// Re-export for index.ts
export { createCdpClient };
