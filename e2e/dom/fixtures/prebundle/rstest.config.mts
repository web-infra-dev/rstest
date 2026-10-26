import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: (['jsdom', 'happy-dom'] as const).map((name) => ({
    name,
    testEnvironment: name,
  })),
});
