import { resolveBreakpoint } from './mapping';
import type { CliOptions } from './plan';
import type {
  CdpClient,
  ExecutionError,
  MappingDiagnostics,
  TaskDefinition,
} from './types';
import { MAX_DEBUG_MAPPING, MAX_MAPPING_DIAGNOSTICS } from './types';

export class BreakpointInstaller {
  private readonly cdp: CdpClient;
  private readonly rootDir: string;
  private readonly options: CliOptions;
  private readonly debugLog: (...args: unknown[]) => void;

  private readonly attemptedInstalls: Set<string>;
  private readonly breakpoints: Map<string, TaskDefinition>;
  private readonly armedTaskIds: Set<string>;

  private readonly mappingDiagnostics: MappingDiagnostics[];
  private readonly errors: ExecutionError[];

  constructor({
    cdp,
    rootDir,
    options,
    debugLog,
    attemptedInstalls,
    breakpoints,
    armedTaskIds,
    mappingDiagnostics,
    errors,
  }: {
    cdp: CdpClient;
    rootDir: string;
    options: CliOptions;
    debugLog: (...args: unknown[]) => void;
    attemptedInstalls: Set<string>;
    breakpoints: Map<string, TaskDefinition>;
    armedTaskIds: Set<string>;
    mappingDiagnostics: MappingDiagnostics[];
    errors: ExecutionError[];
  }) {
    this.cdp = cdp;
    this.rootDir = rootDir;
    this.options = options;
    this.debugLog = debugLog;
    this.attemptedInstalls = attemptedInstalls;
    this.breakpoints = breakpoints;
    this.armedTaskIds = armedTaskIds;
    this.mappingDiagnostics = mappingDiagnostics;
    this.errors = errors;
  }

  async installForScript({
    scriptId,
    url,
    tasks,
  }: {
    scriptId: string;
    url?: string;
    tasks: TaskDefinition[];
  }): Promise<number> {
    if (!tasks.length) return 0;

    const tasksToResolve: TaskDefinition[] = [];
    for (const task of tasks) {
      const key = `${scriptId}:${task.id}`;
      if (this.attemptedInstalls.has(key)) continue;
      this.attemptedInstalls.add(key);
      tasksToResolve.push(task);
    }
    if (!tasksToResolve.length) return 0;

    const installed = await Promise.all(
      tasksToResolve.map(async (task): Promise<boolean> => {
        const resolution = await resolveBreakpoint({
          cdp: this.cdp,
          scriptId,
          url,
          task,
          rootDir: this.rootDir,
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
          return false;
        }

        try {
          const result = await this.cdp.send<{ breakpointId: string }>(
            'Debugger.setBreakpoint',
            { location: resolution.location },
          );
          this.breakpoints.set(result.breakpointId, task);
          this.armedTaskIds.add(task.id);
          this.debugLog(
            `breakpoint set for ${task.id} at ${resolution.location.scriptId}`,
            `${resolution.location.lineNumber}:${resolution.location.columnNumber}`,
          );
          return true;
        } catch (error) {
          this.errors.push({
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      }),
    );

    return installed.filter(Boolean).length;
  }
}
