import { expect, it } from '@rstest/core';

declare global {
  var __rstestListWorkerCleanupCount: number | undefined;
}

expect(globalThis.__rstestListWorkerCleanupCount ?? 0).toBe(0);

it('collects the first file', () => {});
