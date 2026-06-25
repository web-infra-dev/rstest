import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  // One reused worker so a.test pins the clock and b.test runs after it in the
  // same realm, making the cross-file Date leak observable.
  pool: { maxWorkers: 1 },
});
