import { registerWorkerCleanup } from '@rstest/core/internal/node-runtime';

declare global {
  var __rstestListWorkerCleanupCount: number | undefined;
}

globalThis.__rstestListWorkerCleanupCount ??= 0;

registerWorkerCleanup(() => {
  globalThis.__rstestListWorkerCleanupCount! += 1;
});
