import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    include: ['src/**/*.{js,jsx,ts,tsx}'],
    reporters: ['text'],
  },
  setupFiles: ['./rstest.setup.ts'],
});
