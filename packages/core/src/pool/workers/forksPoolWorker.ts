import { type ChildProcess, type ForkOptions, fork } from 'node:child_process';
import EventEmitter from 'node:events';
import { getWorkerSerialization, killAndWait } from '../../utils';
import type {
  PoolWorker,
  PoolWorkerEventName,
  PoolWorkerEvents,
} from '../poolWorker';
import type { Envelope, WorkerRequest } from '../protocol';
import { wrapWorkerRequest } from '../protocol';

const MAX_CAPTURED_STDERR_BYTES = 1024 * 1024; // 1 MB
const STDERR_SETTLE_MAX_WAIT = 200; // ms

const BENIGN_IPC_ERROR_CODES = new Set([
  'ERR_IPC_CHANNEL_CLOSED',
  'EPIPE',
  'ECONNRESET',
  'ERR_STREAM_WRITE_AFTER_END',
]);

/**
 * IPC errors that surface during shutdown but reflect the channel already
 * going away, not a genuine failure. Windows additionally surfaces
 * `write UNKNOWN` when `child.send` races teardown — see rstest#1142.
 */
const isBenignIpcError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && BENIGN_IPC_ERROR_CODES.has(code)) return true;
  if (code === 'UNKNOWN') return true;
  return /write UNKNOWN|channel closed/i.test(err.message);
};

type ForksPoolWorkerOptions = {
  name: string;
  filename: string;
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
  forwardStdio?: boolean;
};

/**
 * The current `PoolWorker` implementation. Spawns a child via
 * `node:child_process.fork`, pipes stdio to the host, buffers stderr for
 * crash enrichment, and swallows benign IPC errors observed during shutdown
 * (rstest#1142).
 */
export class ForksPoolWorker implements PoolWorker {
  readonly name: string;

  private readonly emitter = new EventEmitter();
  private readonly filename: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly execArgv?: string[];
  private readonly forwardStdio: boolean;
  private childProcess: ChildProcess | undefined;
  private stderrBuffer = '';
  private stderrBytes = 0;
  private stderrClosePromise: Promise<void> | undefined;
  private startPromise?: Promise<void>;
  private exited = false;

  constructor(options: ForksPoolWorkerOptions) {
    this.name = options.name;
    this.filename = options.filename;
    this.env = options.env;
    this.execArgv = options.execArgv;
    this.forwardStdio = options.forwardStdio ?? true;
  }

  get pid(): number | undefined {
    return this.childProcess?.pid;
  }

  hasLiveChild(): boolean {
    return this.childProcess !== undefined && !this.exited;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const forkOptions: ForkOptions = {
        env: this.env,
        execArgv: this.execArgv,
        // stderr stays piped so we can capture it for error enrichment even
        // when host forwarding is off; stdout is unused for capture, so drop
        // the pipe entirely when we're not forwarding.
        stdio: ['ignore', this.forwardStdio ? 'pipe' : 'ignore', 'pipe', 'ipc'],
        serialization: getWorkerSerialization(),
      };

      let child: ChildProcess;
      try {
        child = fork(this.filename, [], forkOptions);
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.childProcess = child;

      // Pipe child stdio to the host process so native crash logs / warnings
      // remain visible. Tinypool did this by default; preserve the behavior.
      if (this.forwardStdio) {
        child.stdout?.on('data', (chunk: Buffer) => {
          process.stdout.write(chunk);
        });
      }
      child.stderr?.on('data', (chunk: Buffer) => {
        this.appendStderr(chunk.toString());
        if (this.forwardStdio) process.stderr.write(chunk);
      });
      if (child.stderr) {
        this.stderrClosePromise = new Promise<void>((resolve) => {
          child.stderr!.once('close', resolve);
        });
      }

      child.on('message', (message: unknown) => {
        this.emitter.emit('message', message);
      });

      child.on('error', (err: Error) => {
        if (isBenignIpcError(err)) return;
        this.emitter.emit('error', err);
        settleReject(err);
      });

      // Use `exit`, not `close`. `close` waits for all processes holding
      // the stdio pipes to release them — if a test spawns a subprocess
      // that inherits the worker's stdout/stderr, `close` blocks until
      // that grandchild exits too, stalling slot reclaim and potentially
      // hanging the pool until WORKER_STOP_TIMEOUT_MS force-kills.
      // `exit` fires as soon as the worker process itself exits, which
      // is what the pool lifecycle actually cares about. The stderr
      // `data` listener above already captures output incrementally, so
      // the buffer is nearly complete by the time `exit` fires.
      child.on('exit', (code, signal) => {
        this.exited = true;
        this.emitter.emit('exit', code, signal);
        settleReject(
          new Error(
            `Worker exited before start ack (code=${code}, signal=${signal})`,
          ),
        );
      });

      // Process is ready to receive the `start` request. The runner sends
      // it immediately after this resolves.
      settleResolve();
    });

    return this.startPromise;
  }

  async stop(options?: { force?: boolean }): Promise<void> {
    if (!this.hasLiveChild()) return;
    await killAndWait(
      this.childProcess!,
      options?.force ? 'SIGKILL' : 'SIGTERM',
    );
  }

  send(request: WorkerRequest): void {
    this.sendRaw(wrapWorkerRequest(request));
  }

  sendRaw(envelope: Envelope): void {
    const child = this.childProcess;
    if (!child || this.exited || !child.connected) return;
    try {
      child.send(envelope, (err) => {
        if (err && !isBenignIpcError(err)) {
          this.emitter.emit('error', err);
        }
      });
    } catch (err) {
      if (!isBenignIpcError(err)) throw err;
    }
  }

  on<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.emitter.on(event, listener as (...args: any[]) => void);
  }

  off<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.emitter.off(event, listener as (...args: any[]) => void);
  }

  async waitForStderrSettle(): Promise<void> {
    if (!this.stderrClosePromise) return;
    await Promise.race([
      this.stderrClosePromise,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STDERR_SETTLE_MAX_WAIT);
        timer.unref();
      }),
    ]);
  }

  getCapturedStderr(): string {
    return this.stderrBuffer;
  }

  resetCapturedStderr(): void {
    this.stderrBuffer = '';
    this.stderrBytes = 0;
  }

  private appendStderr(text: string): void {
    if (!text) return;
    this.stderrBuffer += text;
    this.stderrBytes += Buffer.byteLength(text);
    if (this.stderrBytes > MAX_CAPTURED_STDERR_BYTES) {
      // Drop the oldest bytes; keep the tail since crash output is at the end.
      const overflow = this.stderrBytes - MAX_CAPTURED_STDERR_BYTES;
      this.stderrBuffer = this.stderrBuffer.slice(overflow);
      this.stderrBytes = Buffer.byteLength(this.stderrBuffer);
    }
  }
}
