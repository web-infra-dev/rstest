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
  private readonly onTaskMapped?: (
    taskId: string,
    location: {
      scriptId: string;
      lineNumber: number;
      columnNumber: number;
    },
  ) => void;

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
    onTaskMapped,
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
    onTaskMapped?: (
      taskId: string,
      location: {
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
      },
    ) => void;
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
    this.onTaskMapped = onTaskMapped;
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
          const location = await this.findBreakableLocation(
            resolution.location,
          );

          // Record the mapped location early so error-pauses (exceptions / promise
          // rejections) can be matched even if they happen before breakpoints are
          // fully armed.
          this.onTaskMapped?.(task.id, location);

          const result = await this.cdp.send<{
            breakpointId: string;
            actualLocation?: {
              scriptId: string;
              lineNumber: number;
              columnNumber: number;
            };
          }>('Debugger.setBreakpoint', { location });

          const finalLocation = result.actualLocation ?? location;
          this.onTaskMapped?.(task.id, finalLocation);

          this.breakpoints.set(result.breakpointId, task);
          this.armedTaskIds.add(task.id);
          this.debugLog(
            `breakpoint set for ${task.id} at ${location.scriptId}`,
            `${location.lineNumber}:${location.columnNumber}`,
          );
          if (this.options.debug && result.actualLocation) {
            this.debugLog(
              'actualLocation',
              `${result.actualLocation.scriptId}`,
              `${result.actualLocation.lineNumber}:${result.actualLocation.columnNumber}`,
            );
          }
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

  private async findBreakableLocation(location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  }): Promise<{ scriptId: string; lineNumber: number; columnNumber: number }> {
    // `setBreakpoint` can succeed even when the exact location is not breakable,
    // which results in a breakpoint that never hits. Use `getPossibleBreakpoints`
    // to snap to an actual breakable location near the mapped position.
    try {
      const startLine = Math.max(location.lineNumber - 1, 0);
      const endLine = location.lineNumber + 3;
      const { locations } = await this.cdp.send<{
        locations: Array<{
          scriptId: string;
          lineNumber: number;
          columnNumber: number;
        }>;
      }>('Debugger.getPossibleBreakpoints', {
        start: {
          scriptId: location.scriptId,
          lineNumber: startLine,
          columnNumber: 0,
        },
        end: {
          scriptId: location.scriptId,
          lineNumber: endLine,
          columnNumber: 0,
        },
        restrictToFunction: false,
      });

      if (!locations?.length) return location;

      const preferred = locations.find(
        (l) =>
          l.scriptId === location.scriptId &&
          (l.lineNumber > location.lineNumber ||
            (l.lineNumber === location.lineNumber &&
              l.columnNumber >= location.columnNumber)),
      );

      return preferred ?? locations[0] ?? location;
    } catch {
      return location;
    }
  }
}
