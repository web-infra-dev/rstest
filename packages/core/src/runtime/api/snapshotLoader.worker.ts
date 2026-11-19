import { ensureSnapshotClient, SnapshotPlugin } from './snapshot';

// Reused so repeated calls resolve the same object.
const snapshotModule = { SnapshotPlugin, ensureSnapshotClient };

/**
 * Node worker build only (aliased from `./snapshotLoader`): every task creates
 * the runtime, so the snapshot client is folded into `worker.js` instead of
 * costing another dynamic chunk import on the first task.
 */
export const loadSnapshotModule = (): Promise<
  Pick<typeof import('./snapshot'), 'SnapshotPlugin' | 'ensureSnapshotClient'>
> => Promise.resolve(snapshotModule);
