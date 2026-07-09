import type {
  TestCaseInfo,
  TestResult,
  TestSuiteInfo,
} from '../../types/testSuite';
import type { TraceEvent } from '../../utils/trace';
import { getRealNow } from '../util';

type PhaseName =
  | 'prepare'
  | 'envSetup'
  | 'load'
  | 'setupFiles'
  | 'collect'
  | 'tests'
  | 'coverage'
  | 'teardown';

export type PhaseTrackerOptions = {
  /** When set, the tracker also records a Perfetto trace event per phase span. */
  trace?: {
    testPath: string;
    project: string;
  };
  /**
   * Override the Perfetto `pid` recorded on emitted events. Defaults to
   * `process.pid`. Browser mode uses this to give each test file its own
   * synthetic process, so Perfetto labels every track with the file path
   * (mirroring node mode's per-file isolation) instead of collapsing every
   * file under the shared host pid.
   */
  pid?: number;
};

type TraceState = {
  events: TraceEvent[];
  meta: NonNullable<PhaseTrackerOptions['trace']>;
  /** Start timestamps (ms, wall-clock) keyed by testId. */
  suiteStarts: Map<string, number>;
  caseStarts: Map<string, number>;
};

type SliceCat = 'phase' | 'suite' | 'case';

/**
 * Records phase transitions for a single test file as Perfetto-compatible
 * trace events. Used only when the `--trace` CLI flag is enabled; with trace
 * disabled the tracker is a no-op.
 *
 * Emitted events:
 * - per-phase `ph: 'X'` spans (`cat: 'phase'`)
 * - per-suite / per-case `ph: 'X'` spans (`cat: 'suite' | 'case'`), recorded
 *   via the runner's existing lifecycle hooks (zero intrusion into runner.ts)
 * - heap-usage counter samples (`ph: 'C'`, `cat: 'memory'`) at each phase
 *   boundary, so memory pressure shows up as a track in Perfetto UI
 *
 * Events default to `pid = process.pid` (callers may override via
 * `options.pid` — browser host uses a synthetic per-file pid). Each tracker
 * (i.e. each test file) gets its own `tid`, so when a worker is reused
 * across multiple files (`isolate: false`) each file shows up as its own
 * thread track in Perfetto instead of collapsing to the first file's label.
 * The host later merges every worker's events into a single trace JSON file.
 */
export class PhaseTracker {
  private currentPhase: PhaseName | null = null;
  private currentStart = 0;
  private readonly trace: TraceState | null;
  private readonly pid: number;
  private readonly tid = nextThreadId++;

  constructor(options: PhaseTrackerOptions = {}) {
    this.pid = options.pid ?? process.pid;
    this.trace = options.trace
      ? {
          events: [],
          meta: options.trace,
          suiteStarts: new Map(),
          caseStarts: new Map(),
        }
      : null;
  }

  transition(phase: PhaseName): void {
    if (!this.trace) return;
    const now = getRealNow();
    if (this.currentPhase) {
      this.pushSlice(
        this.currentPhase,
        'phase',
        this.currentStart,
        now - this.currentStart,
      );
    }
    this.sampleHeap(now);
    this.currentPhase = phase;
    this.currentStart = now;
  }

  end(): void {
    if (!this.trace || !this.currentPhase) return;
    const now = getRealNow();
    this.pushSlice(
      this.currentPhase,
      'phase',
      this.currentStart,
      now - this.currentStart,
    );
    this.sampleHeap(now);
    this.currentPhase = null;
  }

  recordSuiteStart(info: TestSuiteInfo): void {
    if (!this.trace) return;
    this.trace.suiteStarts.set(info.testId, getRealNow());
  }

  recordSuiteResult(result: TestResult): void {
    if (!this.trace) return;
    const start = this.trace.suiteStarts.get(result.testId);
    this.trace.suiteStarts.delete(result.testId);
    if (start === undefined || typeof result.duration !== 'number') return;
    this.pushSlice(result.name || '<suite>', 'suite', start, result.duration, {
      testId: result.testId,
      status: result.status,
    });
  }

  recordCaseStart(info: TestCaseInfo): void {
    if (!this.trace) return;
    // Prefer the runner's authoritative start time when present so the slice
    // aligns exactly with the case's reported duration.
    const start =
      typeof info.startTime === 'number' ? info.startTime : getRealNow();
    this.trace.caseStarts.set(info.testId, start);
  }

  recordCaseResult(result: TestResult): void {
    if (!this.trace) return;
    const start = this.trace.caseStarts.get(result.testId);
    this.trace.caseStarts.delete(result.testId);
    if (start === undefined || typeof result.duration !== 'number') return;
    this.pushSlice(result.name, 'case', start, result.duration, {
      testId: result.testId,
      status: result.status,
      retryCount: result.retryCount,
    });
  }

  getTraceEvents(): TraceEvent[] | undefined {
    return this.trace && this.trace.events.length
      ? this.trace.events
      : undefined;
  }

  private pushSlice(
    name: string,
    cat: SliceCat,
    startMs: number,
    durMs: number,
    extraArgs?: Record<string, string | number | boolean | undefined>,
  ): void {
    if (!this.trace) return;
    this.trace.events.push({
      name,
      cat,
      ph: 'X',
      ts: startMs * 1000,
      dur: durMs * 1000,
      pid: this.pid,
      tid: this.tid,
      args: {
        testPath: this.trace.meta.testPath,
        project: this.trace.meta.project,
        ...extraArgs,
      },
    });
  }

  private sampleHeap(nowMs: number): void {
    if (!this.trace) return;
    const mem = process.memoryUsage();
    this.trace.events.push({
      name: 'heap',
      cat: 'memory',
      ph: 'C',
      ts: nowMs * 1000,
      pid: this.pid,
      tid: this.tid,
      args: {
        heapUsedMB: round2(mem.heapUsed / 1024 / 1024),
        heapTotalMB: round2(mem.heapTotal / 1024 / 1024),
        rssMB: round2(mem.rss / 1024 / 1024),
      },
    });
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Monotonic counter for `tid` assignment within a worker process. Resets per
 * process (each fork starts at 1), which is fine because Perfetto's `tid` is
 * only required to be unique within a `pid`.
 */
let nextThreadId = 1;
