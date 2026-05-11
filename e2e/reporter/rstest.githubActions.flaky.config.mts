import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['flaky-fixtures/githubActionsFlaky.test.ts'],
  retry: 1,
});
