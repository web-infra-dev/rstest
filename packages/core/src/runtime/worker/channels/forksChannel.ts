import type { Envelope } from '../../../pool/protocol';
import { BaseChannel } from './baseChannel';

export class ForksChannel extends BaseChannel {
  protected readonly source: NodeJS.Process = process;
  private readonly processSend: typeof process.send =
    process.send?.bind(process);

  protected post(envelope: Envelope): void {
    if (!this.processSend) return;
    this.processSend(envelope);
  }
}
