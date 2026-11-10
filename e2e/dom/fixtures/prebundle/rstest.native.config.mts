import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: (['jsdom', 'happy-dom'] as const).map((name) => ({
    name,
    include: ['./index.test.ts'],
    globalSetup: ['./global-setup-unused.ts'],
    testEnvironment: {
      name,
      prebundle: false,
    },
  })),
});
