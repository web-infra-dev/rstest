import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/fixtures/agent-md/truncated.test.ts'],
  reporters: [
    [
      'md',
      {
        preset: 'compact',
        header: { env: false },
        reproduction: 'file+name',
        failures: { max: 2 },
        candidateFiles: false,
        stack: false,
        codeFrame: false,
        console: false,
      },
    ],
  ],
});
