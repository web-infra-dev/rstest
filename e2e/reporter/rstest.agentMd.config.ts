import { defineConfig } from '@rstest/core';
import { createMdReporter } from '@rstest/reporter-agent-md';

export default defineConfig({
  include: ['**/fixtures/agent-md/**'],
  reporters: [
    createMdReporter({
      includeConsole: false,
      includeCodeFrame: false,
      includeEnv: false,
      includeCandidateFiles: false,
      includeFullStackFrames: false,
      includeSnapshotSummary: false,
      maxStackFrames: 5,
    }),
  ],
});
