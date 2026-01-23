import { defineConfig } from '@rstest/core';
import { createMdReporter } from '@rstest/reporter-agent-md';

const forceDefaultReporter = process.env.RSTEST_FORCE_DEFAULT === '1';

export default defineConfig({
  root: __dirname,
  reporters: forceDefaultReporter
    ? ['default']
    : [
        createMdReporter({
          includeConsole: true,
          includeCodeFrame: true,
          includeCandidateFiles: true,
          maxConsoleLogsPerTestPath: 20,
        }),
      ],
});
