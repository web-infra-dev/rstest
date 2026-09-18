import type { Envelope } from '../../../pool/protocol';
import { BaseChannel } from './baseChannel';

type ForkProcess = NodeJS.EventEmitter & Pick<NodeJS.Process, 'send'>;

type PendingWrite = {
  promise: Promise<void>;
  settle: () => void;
};

export class ForksChannel extends BaseChannel {
  protected readonly source: ForkProcess;
  private readonly processSend: typeof process.send;
  private readonly pendingWrites = new Set<PendingWrite>();

  constructor(source: ForkProcess = process) {
    super();
    this.source = source;
    this.processSend = source.send?.bind(source);
  }

  override waitForPendingWrites(): Promise<void> {
    return Promise.all(
      [...this.pendingWrites].map(({ promise }) => promise),
    ).then(() => undefined);
  }

  protected post(envelope: Envelope): void {
    if (!this.processSend) return;

    let resolveWrite: () => void;
    const pendingWrite: PendingWrite = {
      promise: new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
      settle: () => {
        if (this.pendingWrites.delete(pendingWrite)) {
          resolveWrite();
          if (this.pendingWrites.size === 0) {
            this.source.off('disconnect', this.settlePendingWrites);
          }
        }
      },
    };

    this.pendingWrites.add(pendingWrite);
    if (this.pendingWrites.size === 1) {
      this.source.once('disconnect', this.settlePendingWrites);
    }

    try {
      this.processSend(envelope, pendingWrite.settle);
    } catch (error) {
      pendingWrite.settle();
      throw error;
    }
  }

  private readonly settlePendingWrites = (): void => {
    for (const { settle } of this.pendingWrites) {
      settle();
    }
  };
}
