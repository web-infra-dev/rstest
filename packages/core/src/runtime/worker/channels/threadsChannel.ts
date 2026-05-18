import { type MessagePort, parentPort } from 'node:worker_threads';
import type { Envelope } from '../../../pool/protocol';
import { BaseChannel } from './baseChannel';

export class ThreadsChannel extends BaseChannel {
  protected readonly source: MessagePort = parentPort!;

  protected post(envelope: Envelope): void {
    this.source.postMessage(envelope);
  }
}
