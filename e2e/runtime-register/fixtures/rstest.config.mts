import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['*.test.ts'],
  pool: {
    maxWorkers: 1,
    execArgv: [
      '--require',
      './cjs-register.cjs',
      '--import',
      './register.mjs',
      '--conditions=rstest-e2e',
    ],
  },
});
