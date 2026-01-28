import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/console.test.ts'],
  reporters: [
    [
      'md',
      {
        preset: 'normal',
        header: { env: false },
        reproduction: false,
        candidateFiles: false,
        stack: false,
        console: {
          maxLogsPerTestPath: 10,
          maxCharsPerEntry: 200,
        },
      },
    ],
  ],
});
