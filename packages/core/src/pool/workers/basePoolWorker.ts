import EventEmitter from 'node:events';
import type { Readable } from 'node:stream';
import type {
  PoolWorker,
  PoolWorkerEventName,
  PoolWorkerEvents,
} from '../poolWorker';
import type { Envelope, WorkerRequest } from '../protocol';
import { wrapWorkerRequest } from '../protocol';
import { StderrCapture } from './stderrCapture';

/**
 * Shared scaffolding for `PoolWorker` implementations. Owns emitter, stderr
 * capture, exit state, and the trivially-shared parts of the public contract.
 *
 * Subclasses (`ForksPoolWorker`, `ThreadsPoolWorker`) implement the four
 * primitives that genuinely differ across transports — `start`, `stop`,
 * `sendRaw`, `hasLiveChild` — and call the protected `attachStdout` /
 * `attachStderr` helpers from inside their own `start`.
 *
 * Browser mode does NOT implement this inner pool-worker protocol: a browser
 * "worker" is a long-lived page session draining a file queue (fresh context
 * per file, headed-serial mode, session reuse) that does not fit
 * `start`/`stop`/`sendRaw`/`hasLiveChild`. Browser mode plugs in at the outer
 * `TestExecutor` seam instead ("run these files, emit events, return an
 * outcome"), so this class stays node-only.
 *
 * No transport interface is introduced on purpose: each subclass keeps its
 * native `fork(...)` / `new Worker(...)` call visible and top-down readable.
 */
export abstract class BasePoolWorker implements PoolWorker {
  readonly name: string;

  protected readonly emitter: EventEmitter = new EventEmitter();
  protected readonly stderrCapture: StderrCapture = new StderrCapture();
  protected readonly forwardStdio: boolean;
  protected exited = false;
  protected startPromise?: Promise<void>;

  constructor(opts: { name: string; forwardStdio?: boolean }) {
    this.name = opts.name;
    this.forwardStdio = opts.forwardStdio ?? true;
  }

  abstract hasLiveChild(): boolean;
  abstract start(): Promise<void>;
  abstract stop(options?: { force?: boolean }): Promise<void>;
  abstract sendRaw(envelope: Envelope): void;

  send(request: WorkerRequest): void {
    this.sendRaw(wrapWorkerRequest(request));
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

  getCapturedStderr(): string {
    return this.stderrCapture.get();
  }

  resetCapturedStderr(): void {
    this.stderrCapture.reset();
  }

  waitForStderrSettle(): Promise<void> {
    return this.stderrCapture.waitSettle();
  }

  /**
   * Drain stdout regardless of `forwardStdio`. Without a `data` listener the
   * Readable would buffer past `highWaterMark` and apply backpressure to the
   * worker. When forwarding is on we re-emit to the host's stdout.
   */
  protected attachStdout(stdout: Readable | null | undefined): void {
    if (!stdout) return;
    stdout.on('data', (chunk: Buffer) => {
      if (this.forwardStdio) process.stdout.write(chunk);
    });
  }

  /**
   * Capture stderr to the 1 MB tail buffer (used to enrich crash errors), and
   * optionally forward to the host's stderr. Also tracks `close` so callers
   * can drain pending output after exit before reading the buffer.
   */
  protected attachStderr(stderr: Readable | null | undefined): void {
    if (!stderr) return;
    stderr.on('data', (chunk: Buffer) => {
      this.stderrCapture.append(chunk.toString());
      if (this.forwardStdio) process.stderr.write(chunk);
    });
    this.stderrCapture.trackClose(stderr);
  }
}
