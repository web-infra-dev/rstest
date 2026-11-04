import { defineConfig } from '@rstest/core';

const hooks = process.env.HOOK_ORDER;

export default defineConfig({
  include: [
    hooks === 'parallel'
      ? 'fixtures/hookParallel.test.ts'
      : 'fixtures/hookOrder.test.ts',
  ],
  maxConcurrency: Number(process.env.HOOK_CONCURRENCY || 2),
  hookTimeout: 1000,
  sequence:
    hooks === 'list' || hooks === 'stack' || hooks === 'parallel'
      ? { hooks }
      : {},
  env: {
    HOOK_ORDER: hooks,
    HOOK_FAILURE: process.env.HOOK_FAILURE,
    HOOK_CONCURRENCY: process.env.HOOK_CONCURRENCY,
  },
});
