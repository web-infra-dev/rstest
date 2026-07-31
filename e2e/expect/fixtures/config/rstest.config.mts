import { defineConfig } from '@rstest/core';

export default defineConfig({
  expect: {
    poll: {
      interval: 10,
      timeout: 200,
    },
  },
});
