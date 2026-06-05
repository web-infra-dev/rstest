import { defineConfig } from '@rstest/core';

process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

export default defineConfig({
  reporters: ['default'],
  disableConsoleIntercept: true,
  tools: {
    rspack: {
      watchOptions: {
        aggregateTimeout: 10,
      },
    },
  },
});
