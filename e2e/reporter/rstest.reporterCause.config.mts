import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['fixtures/agent-md-pass/focusedSkip.test.ts'],
  reporters: ['json', './fixtures-cause/assertReporter.mjs'],
});
