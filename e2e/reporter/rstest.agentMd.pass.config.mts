import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md-pass/**'],
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
