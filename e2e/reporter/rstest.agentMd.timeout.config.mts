import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/timeout.test.ts'],
  testTimeout: 20,
  reporters: [
    [
      'md',
      {
        preset: 'compact',
        header: { env: false },
        reproduction: false,
        candidateFiles: false,
        stack: false,
      },
    ],
  ],
});
