import { type ChildProcess, type ForkOptions, fork } from 'node:child_process';
import {
  getWorkerSerialization,
  killAndWait,
  LOST_IPC_MESSAGE_HINT,
  toError,
} from '../../utils';
import type { Envelope } from '../protocol';
import { BasePoolWorker } from './basePoolWorker';

const BENIGN_IPC_ERROR_CODES = new Set<string | undefined>([
  'ERR_IPC_CHANNEL_CLOSED',
  'EPIPE',
  'ECONNRESET',
  'ERR_STREAM_WRITE_AFTER_END',
]);

/**
 * SIGKILL escalation budget after SIGTERM. Defensive guard for native
 * modules that mask SIGTERM.
 */
const SIGKILL_FALLBACK_MS = 500;

/** Child `error` events that only mean the channel is already going away. */
const isBenignIpcError = (err: NodeJS.ErrnoException): boolean =>
  BENIGN_IPC_ERROR_CODES.has(err.code);

type ForksPoolWorkerOptions = {
  name: string;
  filename: string;
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
  forwardStdio?: boolean;
};

/**
 * `PoolWorker` backed by `node:child_process.fork`. Shares lifecycle plumbing
 * with `ThreadsPoolWorker` via `BasePoolWorker`; only the spawn/send/stop
 * primitives and IPC-specific error filtering live here.
 */
export class ForksPoolWorker extends BasePoolWorker {
  private readonly filename: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly execArgv?: string[];
  private childProcess: ChildProcess | undefined;
  private transportFailed = false;

  constructor(options: ForksPoolWorkerOptions) {
    super({ name: options.name, forwardStdio: options.forwardStdio });
    this.filename = options.filename;
    this.env = options.env;
    this.execArgv = options.execArgv;
  }

  hasLiveChild(): boolean {
    return this.childProcess !== undefined && !this.exited;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
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
        reject(toError(err));
        return;
      }

      this.childProcess = child;

      this.attachStdout(child.stdout);
      this.attachStderr(child.stderr);

      child.on('message', (message: unknown) => {
        this.emitter.emit('message', message);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (isBenignIpcError(err)) return;
        this.emitter.emit('error', err);
        reject(err);
      });

      // Use `exit`, not `close`. `close` waits for all processes holding
      // the stdio pipes to release them — if a test spawns a subprocess
      // that inherits the worker's stdout/stderr, `close` blocks until
      // that grandchild exits too, stalling slot reclaim.
      child.on('exit', (code, signal) => {
        this.exited = true;
        this.emitter.emit('exit', code, signal);
        reject(
          new Error(
            `Worker exited before start ack (code=${code}, signal=${signal})`,
          ),
        );
      });

      resolve();
    });

    return this.startPromise;
  }

  async stop(options?: { force?: boolean }): Promise<void> {
    if (!this.hasLiveChild()) return;
    if (options?.force) {
      await killAndWait(this.childProcess!, 'SIGKILL');
      return;
    }
    await killAndWait(this.childProcess!, 'SIGTERM', SIGKILL_FALLBACK_MS);
  }

  sendRaw(envelope: Envelope): void {
    const child = this.childProcess;
    if (!child || this.exited || !child.connected) return;
    try {
      child.send(envelope, this.onSendError);
    } catch (err) {
      this.onSendError(toError(err));
    }
  }

  /**
   * A failed write on a live channel is never benign, whatever its `code`
   * (Windows: `write UNKNOWN`, rstest#1142); once it is gone, `exit` owns it.
   */
  private readonly onSendError = (err: Error | null): void => {
    if (!err || this.transportFailed || !this.childProcess?.connected) return;
    this.transportFailed = true;
    const error = new Error(
      `Failed to send a message to the test worker (${err.message}). ${LOST_IPC_MESSAGE_HINT}`,
    );
    // Reporters receive a serialized error that drops `cause`, so carry the
    // original stack (Node's own send frames) in the wrapper's stack.
    error.stack = `${error.stack ?? error.message}\nCaused by: ${err.stack ?? err.message}`;
    this.emitter.emit('error', error);
  };
}
