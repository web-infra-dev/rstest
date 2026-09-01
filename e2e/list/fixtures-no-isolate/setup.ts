import { registerWorkerCleanup } from '@rstest/core';

declare global {
  var __rstestListWorkerCleanupCount: number | undefined;
}

globalThis.__rstestListWorkerCleanupCount ??= 0;

registerWorkerCleanup(() => {
  globalThis.__rstestListWorkerCleanupCount! += 1;
});
