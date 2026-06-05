import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/unhandled.test.ts'],
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
