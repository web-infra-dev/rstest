import { isMainThread, parentPort } from 'node:worker_threads';
import type { PoolWorkerKind } from '../../../pool/types';
import type { WorkerChannel } from '../workerChannel';
import { ForksChannel } from './forksChannel';
import { ThreadsChannel } from './threadsChannel';

const kind: PoolWorkerKind =
  !isMainThread && parentPort !== null ? 'threads' : 'forks';

const createChannel = (kind: PoolWorkerKind): WorkerChannel => {
  switch (kind) {
    case 'forks':
      return new ForksChannel();
    case 'threads':
      return new ThreadsChannel();
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown channel kind: ${String(_exhaustive)}`);
    }
  }
};

export const channel: WorkerChannel = createChannel(kind);
