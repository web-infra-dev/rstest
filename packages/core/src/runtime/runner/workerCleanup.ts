import type { MaybePromise } from '../../types';

type WorkerCleanup = () => MaybePromise<void>;

const WORKER_CLEANUP_REGISTRY = Symbol.for('rstest.worker.cleanup.registry');

const getWorkerCleanupRegistry = (): Set<WorkerCleanup> => {
  const globalObject = globalThis as unknown as Record<PropertyKey, unknown>;
  let registry = globalObject[WORKER_CLEANUP_REGISTRY] as
    Set<WorkerCleanup> | undefined;

  if (!registry) {
    registry = new Set<WorkerCleanup>();
    globalObject[WORKER_CLEANUP_REGISTRY] = registry;
  }

  return registry;
};

export const registerWorkerCleanup = (
  cleanup: WorkerCleanup,
): (() => boolean) => {
  const registry = getWorkerCleanupRegistry();
  registry.add(cleanup);
  return () => registry.delete(cleanup);
};

export const takeWorkerCleanups = (): WorkerCleanup[] => {
  const registry = getWorkerCleanupRegistry();
  const cleanups = [...registry];
  registry.clear();
  return cleanups;
};
