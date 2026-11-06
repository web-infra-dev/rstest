import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: { maxWorkers: 1 },
  setupFiles: ['./setup.ts'],
  projects:
    process.env.EXPECT_EXTENSION_PROJECTS === 'true'
      ? [
          {
            name: 'first',
            include: ['./*.test.ts'],
            setupFiles: ['./setup.ts'],
          },
          {
            name: 'second',
            include: ['./*.test.ts'],
            setupFiles: ['./setup.ts'],
          },
        ]
      : undefined,
});
