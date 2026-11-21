import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/errorCause.test.ts'],
  globalSetup: './fixtures/agent-md/globalSetupCause.ts',
  reporters: [
    [
      'md',
      {
        preset: 'compact',
        header: { env: false },
        reproduction: false,
        candidateFiles: false,
      },
    ],
  ],
});
