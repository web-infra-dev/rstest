import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*'],
  coverage: {
    enabled: true,
    reporters: ['text'],
    include: ['src/**/*'],
  },
});
