import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    execArgv: ['--invalid-flag'],
  },
  disableConsoleIntercept: true,
});
