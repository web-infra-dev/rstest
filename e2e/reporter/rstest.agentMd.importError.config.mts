import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/importError.test.ts'],
  reporters: [
    [
      'md',
      {
        preset: 'compact',
        header: { env: false },
        reproduction: false,
        stack: 'full',
      },
    ],
  ],
});
