import { defineConfig } from '@rstest/core';
import { pluginMidscene } from '@rstest/midscene/plugin';

const cacheStrategy = process.env.CI ? 'read-only' : 'read-write';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 60000,
  plugins: [
    pluginMidscene({
      agentOptions: {
        replanningCycleLimit: 20,
        autoPrintReportMsg: false,
        cache: {
          id: 'examples-midscene-default',
          strategy: cacheStrategy,
        },
      },
      createAgentOptions: ({ testFile }) => ({
        cache: {
          id: `examples-midscene-${testFile.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          strategy: cacheStrategy,
        },
      }),
    }),
  ],
});
