// ============================================================================
// Types
// ============================================================================

export type Plan = {
  runner: RunnerConfig;
  tasks: TaskDefinition[];
};

export type RunnerConfig = {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};

export type TaskDefinition = {
  id: string;
  description?: string;
  sourcePath: string;
  /** 1-based line number */
  line: number;
  /** 0-based column number */
  column?: number;
  expressions?: string[];
  hitLimit?: number;
  condition?: string;
  order?: number;
  hits?: number;
};

export type TaskResult = {
  id: string;
  description?: string;
  sourcePath: string;
  line: number;
  column: number;
  values: EvaluatedValue[];
};

export type EvaluatedValue = {
  expression: string;
  value: unknown;
  type?: string;
  subtype?: string;
  preview?: string;
};

export type MappingDiagnostics = {
  scriptId: string;
  url?: string;
  taskId: string;
  reason:
    | 'ok'
    | 'no-sourcemap'
    | 'source-mismatch'
    | 'generated-position-missing'
    | 'script-error';
  hasSourceMapComment?: boolean;
  sourcesSample?: string[];
  matchedSource?: string;
  generatedLine?: number;
  generatedColumn?: number;
  error?: string;
};

export type ExecutionError = {
  taskId?: string;
  error: string;
};

/**
 * - 'full_succeed': All tasks completed (all hitLimits reached)
 * - 'partial_succeed': Some results collected, but not all tasks completed
 * - 'failed': No results collected (e.g., no breakpoints resolved, runner crashed)
 */
export type DebugStatus = 'full_succeed' | 'partial_succeed' | 'failed';

export type DebugResult = {
  status: DebugStatus;
  /** Runner exit code (null if killed or not exited) */
  exitCode?: number | null;
  results: TaskResult[];
  errors: ExecutionError[];
  /** Diagnostic metadata, only included in debug mode */
  meta?: {
    runner: RunnerConfig;
    forwardedArgs: string[];
    pendingTaskIds: string[];
    mappingDiagnostics: MappingDiagnostics[];
  };
};

export type CdpClient = {
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  on<TParams = unknown>(
    method: string,
    handler: (params: TParams) => void,
  ): void;
  close(): void;
};

// ============================================================================
// Constants
// ============================================================================

/** Grace period before first resume to allow breakpoints to be set */
export const DEFAULT_FIRST_PAUSE_GRACE_MS = 4_000;

/** Timeout for resolving at least one breakpoint */
export const DEFAULT_BREAKPOINT_RESOLVE_TIMEOUT_MS = 20_000;

/** Timeout between breakpoint hits before giving up */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 40_000;

/** Maximum mapping diagnostics to record (prevents memory bloat) */
export const MAX_MAPPING_DIAGNOSTICS = 50;

/** Maximum scripts to log in debug mode */
export const MAX_DEBUG_SCRIPTS = 10;

/** Maximum mapping diagnostics to log in debug mode */
export const MAX_DEBUG_MAPPING = 10;
