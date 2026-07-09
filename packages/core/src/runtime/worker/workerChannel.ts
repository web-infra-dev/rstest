import type { Envelope } from '../../pool/protocol';

export type MessageHandler = (message: unknown, ...extras: unknown[]) => void;

/**
 * Worker-side host channel. Same `Envelope` framing on both transports;
 * concrete impl is picked based on whether this entry was loaded inside a
 * `worker_threads.Worker` or a `child_process.fork`.
 */
export interface WorkerChannel {
  send(envelope: Envelope): void;
  on(handler: MessageHandler): void;
  off(handler: MessageHandler): void;
}
