import type { Envelope } from '../../../pool/protocol';
import type { MessageHandler, WorkerChannel } from '../workerChannel';

/**
 * Shared `WorkerChannel` scaffolding; subclasses provide transport-specific
 * `post` and the emitter `source` for `'message'` events.
 */
export abstract class BaseChannel implements WorkerChannel {
  protected abstract readonly source: NodeJS.EventEmitter;

  send(envelope: Envelope): void {
    try {
      this.post(envelope);
    } catch {
      // channel may already be closed during shutdown — ignore
    }
  }

  on(handler: MessageHandler): void {
    this.source.on('message', handler);
  }

  off(handler: MessageHandler): void {
    this.source.off('message', handler);
  }

  protected abstract post(envelope: Envelope): void;
}
