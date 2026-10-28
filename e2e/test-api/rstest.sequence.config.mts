import { defineConfig } from '@rstest/core';

const hooks = process.env.HOOK_ORDER;

export default defineConfig({
  include: ['fixtures/hookOrder.test.ts'],
  sequence: hooks === 'list' || hooks === 'stack' ? { hooks } : {},
  env: { HOOK_ORDER: hooks },
});
