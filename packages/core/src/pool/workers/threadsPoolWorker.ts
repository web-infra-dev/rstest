import { Worker } from 'node:worker_threads';
import { toError } from '../../utils';
import type { Envelope } from '../protocol';
import { BasePoolWorker } from './basePoolWorker';

type ThreadsPoolWorkerOptions = {
  name: string;
  filename: string;
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
  forwardStdio?: boolean;
};

/**
 * `PoolWorker` backed by `node:worker_threads`. Shares lifecycle plumbing
 * with `ForksPoolWorker` via `BasePoolWorker`; only the spawn/send/stop
 * primitives live here.
 *
 * Notable differences from forks:
 *  - `worker.terminate()` is a single primitive — no SIGTERM/SIGKILL
 *    escalation, so the `force` option is a no-op.
 *  - No benign-error filtering needed — there is no IPC channel that could
 *    surface `EPIPE` / `ERR_IPC_CHANNEL_CLOSED` during shutdown.
 */
export class ThreadsPoolWorker extends BasePoolWorker {
  private readonly filename: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly execArgv?: string[];
  private worker: Worker | undefined;

  constructor(options: ThreadsPoolWorkerOptions) {
    super({ name: options.name, forwardStdio: options.forwardStdio });
    this.filename = options.filename;
    this.env = options.env;
    this.execArgv = options.execArgv;
  }

  hasLiveChild(): boolean {
    return this.worker !== undefined && !this.exited;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(this.filename, {
          env: this.env,
          execArgv: this.execArgv,
          // Pipe stdout/stderr so we own the streams; forwardStdio is honored
          // inside attachStdout / attachStderr.
          stdout: true,
          stderr: true,
        });
      } catch (err) {
        reject(toError(err));
        return;
      }

      this.worker = worker;

      this.attachStdout(worker.stdout);
      this.attachStderr(worker.stderr);

      worker.on('message', (message: unknown) => {
        this.emitter.emit('message', message);
      });

      worker.on('error', (err: Error) => {
        this.emitter.emit('error', err);
        reject(err);
      });

      worker.on('exit', (code: number) => {
        this.exited = true;
        // Threads only carry an exit code — no signal. Pass `null` to keep
        // the PoolWorkerEvents shape stable across pool implementations.
        this.emitter.emit('exit', code, null);
        reject(new Error(`Worker exited before start ack (code=${code})`));
      });

      resolve();
    });

    return this.startPromise;
  }

  async stop(_options?: { force?: boolean }): Promise<void> {
    if (!this.hasLiveChild()) return;
    // `worker.terminate()` is the single primitive: it stops the thread
    // immediately and resolves with the exit code. There is no SIGTERM/
    // SIGKILL distinction for threads, so `force` is a no-op — the host's
    // graceful path (sending the `stop` envelope and awaiting `stopped`)
    // already runs in `PoolRunner.stop` before this is called as a fallback.
    await this.worker!.terminate().catch(() => undefined);
  }

  sendRaw(envelope: Envelope): void {
    const worker = this.worker;
    if (!worker || this.exited) return;
    try {
      worker.postMessage(envelope);
    } catch (err) {
      // `postMessage` throws synchronously if the worker has already exited
      // and the channel is gone. Surface it as a transport error rather
      // than letting it bubble up.
      this.emitter.emit('error', toError(err));
    }
  }
}
