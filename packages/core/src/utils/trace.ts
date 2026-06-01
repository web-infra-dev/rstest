import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'pathe';
import { displayPath, isTTY } from './helper';
import { color, logger } from './logger';
import { formatTraceSummary, summarizeTrace } from './traceSummary';

// ---------------------------------------------------------------------------
// Public event type
// ---------------------------------------------------------------------------

/**
 * Perfetto/Chrome trace event (subset). Emitted by the worker-side
 * `PhaseTracker` and consumed by the controller below.
 *
 * `ph`:
 * - `'X'`: complete (sliced) event with `dur` — drawn as a slice
 * - `'M'`: metadata (process/thread name, sort index)
 * - `'C'`: counter — `args` numeric values are plotted as tracks
 */
export type TraceEvent = {
  name: string;
  cat: string;
  ph: 'X' | 'M' | 'C';
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, string | number | boolean | undefined>;
};

export type TraceSpan = <T>(
  name: string,
  cat: string,
  fn: () => T | Promise<T>,
  args?: TraceEvent['args'],
) => Promise<T>;

/**
 * Transparent pass-through span used when tracing is disabled, so call sites
 * can always invoke `span(...)` without branching on whether `--trace` is on.
 */
export const noopTraceSpan: TraceSpan = async (_name, _cat, fn) => fn();

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

/**
 * Build the absolute paths for a run's artifacts: the Perfetto trace dump and
 * its markdown summary sidecar. Both share one timestamped stem so the pair is
 * named from a single source (no fragile extension rewriting), and the stamp
 * keeps repeated runs from overwriting each other.
 */
const getTraceOutputPaths = (
  rootPath: string,
): { tracePath: string; summaryPath: string } => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const stem = resolve(rootPath, '.rstest', `trace-${stamp}`);
  return { tracePath: `${stem}.json`, summaryPath: `${stem}.summary.md` };
};

/**
 * Wrap raw phase events into the Perfetto trace JSON envelope and prepend
 * Perfetto metadata so each (pid, tid) renders with the right label.
 *
 * - `process_name` (per pid): when the worker only ran a single test file
 *   (the default `isolate: true` case), use the file path so the row label
 *   surfaces the file directly. When the worker ran multiple files
 *   (`isolate: false`), fall back to `worker <pid>` so the shared-worker
 *   grouping stays visible.
 * - `process_sort_index` (per pid) lists workers in the order they first
 *   produced events, instead of the OS pid order.
 * - `thread_name` (per pid+tid) labels each tracker's thread track with the
 *   test file path it ran (relative to `rootPath`).
 */
const buildTraceFile = (
  events: TraceEvent[],
  rootPath: string,
): { traceEvents: TraceEvent[] } => {
  const meta = (
    name: string,
    pid: number,
    tid: number,
    args: TraceEvent['args'],
  ): TraceEvent => ({
    name,
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid,
    tid,
    args,
  });

  // Count distinct threads per pid up front so the process_name pass can pick
  // between file-path and `worker <pid>` based on actual runtime behavior
  // rather than reading config back.
  const threadIdsByPid = new Map<number, Set<number>>();
  for (const ev of events) {
    let threadIds = threadIdsByPid.get(ev.pid);
    if (!threadIds) {
      threadIds = new Set();
      threadIdsByPid.set(ev.pid, threadIds);
    }
    threadIds.add(ev.tid);
  }

  const seenPid = new Set<number>();
  const seenThread = new Set<string>();
  const metadata: TraceEvent[] = [];
  let sortIndex = 0;
  for (const ev of events) {
    const testPath =
      typeof ev.args?.testPath === 'string' ? ev.args.testPath : undefined;
    if (!testPath) continue;

    if (!seenPid.has(ev.pid)) {
      seenPid.add(ev.pid);
      const sharedWorker = (threadIdsByPid.get(ev.pid)?.size ?? 0) > 1;
      metadata.push(
        meta('process_name', ev.pid, ev.tid, {
          name: sharedWorker
            ? `worker ${ev.pid}`
            : displayPath(testPath, rootPath),
        }),
        meta('process_sort_index', ev.pid, ev.tid, {
          sort_index: sortIndex++,
        }),
      );
    }

    const threadKey = `${ev.pid}:${ev.tid}`;
    if (!seenThread.has(threadKey)) {
      seenThread.add(threadKey);
      metadata.push(
        meta('thread_name', ev.pid, ev.tid, {
          name: displayPath(testPath, rootPath),
        }),
      );
    }
  }
  return { traceEvents: [...metadata, ...events] };
};

// ---------------------------------------------------------------------------
// Perfetto helper HTTP server
// ---------------------------------------------------------------------------

const PERFETTO_ORIGIN = 'https://ui.perfetto.dev';
/**
 * Perfetto UI's CSP only permits fetching from `http://127.0.0.1:9001` (the
 * trace_processor RPC port). Any other port is silently blocked by the
 * browser and surfaces as "Failed to fetch" in the UI.
 *
 * https://github.com/google/perfetto/blob/main/tools/open_trace_in_ui
 */
const PERFETTO_PORT = 9001;
const SERVED_PATH = '/trace.json';
const PERFETTO_URL = `${PERFETTO_ORIGIN}/#!/?url=http://127.0.0.1:${PERFETTO_PORT}${SERVED_PATH}&referrer=rstest`;

type TraceServerHandle = {
  /** Perfetto deep-link URL pointing at this server. */
  url: string;
  /** Switch the file being served (used across re-runs in watch mode). */
  setActiveTrace: (filePath: string) => void;
  /** Stop listening so the Node event loop can exit. */
  close: () => Promise<void>;
  /**
   * Block until SIGINT/SIGTERM/SIGTSTP arrives, then close the server and
   * exit with the current `process.exitCode`. Use this after tests have
   * finished so Ctrl+C is treated as a clean shutdown — without it, the
   * default 128+SIGINT exit code makes pnpm/npm surface ELIFECYCLE.
   */
  waitForExit: () => Promise<never>;
};

/**
 * Tiny localhost HTTP server that serves a single trace JSON file with the
 * CORS headers Perfetto UI requires, so users can click the printed URL and
 * have the trace auto-load in https://ui.perfetto.dev.
 *
 * The server keeps the Node event loop alive — invoke this only when the
 * user actually wants the link, otherwise `rstest run` would hang.
 */
const startTraceServer = (initialPath: string): Promise<TraceServerHandle> => {
  let activePath = initialPath;

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', PERFETTO_ORIGIN);
    res.setHeader('Cache-Control', 'no-cache');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.url !== SERVED_PATH) {
      res.writeHead(404).end();
      return;
    }
    try {
      const data = await readFile(activePath);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(data.byteLength),
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });

  return new Promise<TraceServerHandle>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PERFETTO_PORT, '127.0.0.1', () => {
      server.off('error', reject);
      // closeAllConnections drops in-flight HEAD/GET sockets so close()
      // resolves promptly instead of waiting for keep-alive timeouts.
      const stopListening = (onClosed?: () => void) => {
        server.closeAllConnections?.();
        server.close(onClosed);
      };

      resolve({
        url: PERFETTO_URL,
        setActiveTrace: (filePath) => {
          activePath = filePath;
        },
        close: () => new Promise<void>((res) => stopListening(() => res())),
        waitForExit: () =>
          new Promise<never>(() => {
            // Synchronous exit — terminates before any other SIGINT listener
            // (e.g. the runner's "exit 128+SIG" handler) gets an async tick to
            // override the exit code. The OS reaps the listening socket on
            // process termination, so close() is best-effort.
            const onSignal = () => {
              stopListening();
              process.exit();
            };
            process.once('SIGINT', onSignal);
            process.once('SIGTERM', onSignal);
            process.once('SIGTSTP', onSignal);
          }),
      });
    });
  });
};

// ---------------------------------------------------------------------------
// Controller: the single surface consumed by `runTests`
// ---------------------------------------------------------------------------

export interface TraceRun {
  /**
   * Pass to `pool.runTests` as `onTraceEvents`. `undefined` when tracing is
   * disabled, so the pool layer skips collecting events entirely.
   */
  onEvents: ((events: TraceEvent[]) => void) | undefined;
  /** Record a host-side Perfetto slice in the current run. */
  span: TraceSpan;
  /**
   * Write the buffered events for this run to disk and (lazily) start or
   * refresh the Perfetto helper server. No-op when nothing was collected.
   */
  finalize: () => Promise<void>;
}

export interface TraceController {
  /** Begin a per-run handle that buffers events until `finalize`. */
  beginRun: () => TraceRun;
  /** Stop the helper server. No-op if it never started. */
  close: () => Promise<void>;
  /**
   * If a trace was produced this session, print a Ctrl+C hint and block
   * until the user signals; then exit with the current `process.exitCode`.
   */
  waitForExit: () => Promise<void>;
  /**
   * Convenience for early-return paths: `finalize` the supplied run, then
   * `waitForExit` (blocks for SIGINT only when a helper server is up — i.e.
   * tracing produced output in an interactive TTY), then `close` defensively.
   * No-op for each step when tracing is disabled.
   */
  shutdown: (run: TraceRun) => Promise<void>;
}

/**
 * Owns every concern of `--trace`: per-run event collection, file output,
 * the Perfetto helper server lifecycle, and the post-run "wait for Ctrl+C"
 * handoff. The orchestrator (e.g. `runTests`) only wires `onEvents` into
 * the pool and calls `finalize`/`close`/`waitForExit` at the right
 * lifecycle points.
 */
export const createTraceController = (options: {
  enabled: boolean;
  rootPath: string;
}): TraceController => {
  const { enabled, rootPath } = options;
  let server: TraceServerHandle | undefined;
  // Path of the trace file produced by the previous run in this session.
  // In watch mode we replace it on each rerun so .rstest/ does not accumulate
  // multi-MB JSONs; files from earlier sessions are left alone.
  let lastTracePath: string | undefined;
  // Sidecar `.summary.md` produced alongside the trace; replaced on rerun in
  // watch mode for the same reason as `lastTracePath`.
  let lastSummaryPath: string | undefined;

  const beginRun = (): TraceRun => {
    if (!enabled) {
      return {
        onEvents: undefined,
        span: noopTraceSpan,
        finalize: async () => {},
      };
    }
    const events: TraceEvent[] = [];
    const pushHostSlice: TraceSpan = async (name, cat, fn, args) => {
      const start = Date.now();
      try {
        return await fn();
      } finally {
        const end = Date.now();
        events.push({
          name,
          cat,
          ph: 'X',
          ts: start * 1000,
          dur: (end - start) * 1000,
          pid: process.pid,
          tid: 0,
          args: {
            testPath: '<host>',
            project: 'host',
            ...args,
          },
        });
      }
    };
    return {
      // Iterate instead of spreading: a single file with thousands of cases
      // can hand `chunk` a very large array, and `push(...chunk)` would then
      // exceed V8's argument-list limit and throw `RangeError: Maximum call
      // stack size exceeded` before the trace is ever written.
      onEvents: (chunk) => {
        for (const ev of chunk) events.push(ev);
      },
      span: pushHostSlice,
      finalize: async () => {
        if (!events.length) return;
        const { tracePath, summaryPath } = getTraceOutputPaths(rootPath);
        await mkdir(dirname(tracePath), { recursive: true });
        await writeFile(
          tracePath,
          JSON.stringify(buildTraceFile(events, rootPath)),
        );
        if (lastTracePath && lastTracePath !== tracePath) {
          // Best-effort: ignore ENOENT if the user already removed it.
          unlink(lastTracePath).catch(() => {});
        }
        lastTracePath = tracePath;

        // Agent/CI-friendly text summary: the Perfetto JSON is a raw event
        // dump meant for the visual UI, so always emit a ranked markdown
        // digest (printed to stdout and written next to the trace) that
        // answers "where did time go" without opening a flame graph.
        const summaryMarkdown = formatTraceSummary(
          summarizeTrace(events, rootPath),
        );
        await writeFile(summaryPath, `${summaryMarkdown}\n`);
        if (lastSummaryPath && lastSummaryPath !== summaryPath) {
          unlink(lastSummaryPath).catch(() => {});
        }
        lastSummaryPath = summaryPath;

        logger.log(`\n${summaryMarkdown}\n`);
        logger.log(
          color.gray('  Perfetto trace file: '),
          color.cyan(tracePath),
        );
        logger.log(
          color.gray('  Trace summary file: '),
          color.cyan(summaryPath),
        );
        // The helper server keeps the event loop alive until SIGINT, which
        // would hang `rstest run` in CI. Only start it in an interactive TTY,
        // otherwise leave the file for the user to download from the CI
        // artifact and open in Perfetto UI manually.
        if (!isTTY('stdin')) {
          logger.log(
            color.gray(
              '  Drag the file above into https://ui.perfetto.dev to view.',
            ),
          );
          return;
        }
        if (!server) {
          try {
            server = await startTraceServer(tracePath);
          } catch (err) {
            logger.log(
              color.yellow(
                `  Could not start Perfetto helper server: ${(err as Error).message}`,
              ),
              color.gray(
                '\n  Drag the file above into https://ui.perfetto.dev to view.',
              ),
            );
            return;
          }
        } else {
          server.setActiveTrace(tracePath);
        }
        logger.log(
          color.gray('  Open in Perfetto UI: '),
          color.cyan(server.url),
        );
      },
    };
  };

  const controller: TraceController = {
    beginRun,
    close: async () => {
      if (!server) return;
      const s = server;
      server = undefined;
      await s.close();
    },
    waitForExit: async () => {
      if (!server) return;
      logger.log(
        color.gray(
          '  Press Ctrl+C to stop the Perfetto helper server and exit.',
        ),
      );
      await server.waitForExit();
    },
    shutdown: async (run) => {
      await run.finalize();
      await controller.waitForExit();
      await controller.close();
    },
  };
  return controller;
};
