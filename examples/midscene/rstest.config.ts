import { defineConfig } from '@rstest/core';
import { withMidscene } from '@rstest/midscene';

const cacheStrategy = process.env.CI ? 'read-only' : 'read-write';

export default defineConfig({
  extends: withMidscene({
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
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
});
