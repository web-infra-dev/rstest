import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  include: ['tests/**/*.test.ts'],
  // Keep the whole test pipeline in the bench process so CodSpeed CPU
  // simulation (Callgrind) can measure it. See `benchmarks/suiteRun.mjs`.
  pool: 'threads',
});
