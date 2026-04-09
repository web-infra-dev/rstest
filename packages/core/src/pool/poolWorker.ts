import type { Envelope, WorkerRequest } from './protocol';

export type PoolWorkerEvents = {
  message: (message: unknown) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export type PoolWorkerEventName = keyof PoolWorkerEvents;

/**
 * Transport-agnostic worker abstraction. Owns spawn/stop, stdio capture,
 * signal handling, and message framing. Does NOT own the lifecycle state
 * machine, birpc wiring, scheduling, or task attribution — those live in
 * `PoolRunner` and `Pool`.
 *
 * Phase 1 ships exactly one implementation (`ForksPoolWorker`). The interface
 * is deliberately minimal so threads / browser implementations in later
 * phases can be added without touching `Pool` or `PoolRunner`.
 */
export interface PoolWorker {
  readonly name: string;
  start(): Promise<void>;
  stop(options?: { force?: boolean }): Promise<void>;
  /** Framed lifecycle message. */
  send(request: WorkerRequest): void;
  /** Raw envelope path, used by birpc RPC passthrough. */
  sendRaw(envelope: Envelope): void;
  on<E extends PoolWorkerEventName>(event: E, listener: PoolWorkerEvents[E]): void;
  off<E extends PoolWorkerEventName>(event: E, listener: PoolWorkerEvents[E]): void;
  /** Captured stderr buffer for crash enrichment. */
  getCapturedStderr(): string;
  /**
   * Clear the captured stderr buffer. Called between tasks on a reused worker
   * (`isolate: false`) so the next failure attribution only sees stderr that
   * belongs to the current task.
   */
  resetCapturedStderr(): void;
  /**
   * True when the worker still has a running child process that needs to be
   * terminated. Used by `PoolRunner.stop` to decide whether the STOPPING
   * path must wait for an `exit`/`close` event (and therefore whether it is
   * safe to install `stopHandlers` without deadlocking when there is simply
   * nothing to reap — e.g. `fork()` never produced a child).
   */
  hasLiveChild(): boolean;
}
