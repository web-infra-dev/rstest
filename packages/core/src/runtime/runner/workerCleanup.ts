import {
  type CleanupCallback,
  createCleanupRegistry,
  type RegisterCleanup,
} from './cleanupRegistry';

export type WorkerCleanup = CleanupCallback;

const workerCleanups = createCleanupRegistry('worker');

export const registerWorkerCleanup: RegisterCleanup = workerCleanups.register;
export const installWorkerCleanupBridge: (
  runtimeGlobal: Record<PropertyKey, unknown>,
) => void = workerCleanups.installBridge;
export const takeWorkerCleanups: () => WorkerCleanup[] = workerCleanups.take;
